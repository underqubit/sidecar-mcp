import axios, { AxiosHeaders } from 'axios';
import type { AuthConfig } from './config-schema.js';
import { SidecarError, checkAbort } from './errors.js';
import { renderString, type Environment } from './templates.js';

interface Token { value: string; expiresAt: number }
interface Pending { promise: Promise<Token>; controller: AbortController; waiters: number }

export class AuthManager {
  private readonly tokens = new Map<string, Token>();
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly profiles: Record<string, AuthConfig>, private readonly env: Environment) {}

  async apply(profileName: string | undefined, headers: AxiosHeaders, query: URLSearchParams, signal: AbortSignal): Promise<void> {
    checkAbort(signal);
    if (!profileName) return;
    const profile = this.profiles[profileName];
    if (!profile) throw new SidecarError('auth', 'Authentication profile not found.');
    const resolve = (value: string): string => renderString(value, {}, this.env);
    switch (profile.type) {
      case 'none': return;
      case 'apiKey':
        if (profile.in === 'header') headers.set(profile.name, resolve(profile.value));
        else query.set(profile.name, resolve(profile.value));
        return;
      case 'bearer': headers.set('Authorization', `Bearer ${resolve(profile.token)}`); return;
      case 'basic':
        headers.set('Authorization', `Basic ${Buffer.from(`${resolve(profile.username)}:${resolve(profile.password)}`).toString('base64')}`);
        return;
      case 'oauth2': headers.set('Authorization', `Bearer ${await this.getToken(profileName, profile, signal)}`); return;
    }
  }

  close(): void {
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
    this.tokens.clear();
  }

  private async getToken(name: string, profile: Extract<AuthConfig, { type: 'oauth2' }>, signal: AbortSignal): Promise<string> {
    const cached = this.tokens.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let pending = this.pending.get(name);
    if (!pending) {
      const controller = new AbortController();
      const entry: Pending = { controller, waiters: 0, promise: Promise.resolve({ value: '', expiresAt: 0 }) };
      entry.promise = this.fetchToken(profile, controller.signal).then(token => {
        if (!controller.signal.aborted && token.expiresAt > Date.now()) this.tokens.set(name, token);
        return token;
      }).finally(() => { if (this.pending.get(name) === entry) this.pending.delete(name); });
      this.pending.set(name, entry);
      pending = entry;
    }
    pending.waiters++;
    const current = pending;
    return new Promise<string>((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown, token?: Token): void => {
        if (finished) return;
        finished = true;
        signal.removeEventListener('abort', aborted);
        current.waiters--;
        if (!current.waiters && this.pending.get(name) === current) {
          this.pending.delete(name);
          current.controller.abort();
        }
        if (error) reject(error); else resolve(token!.value);
      };
      const aborted = (): void => finish(new SidecarError('auth', 'Credential request canceled.'));
      signal.addEventListener('abort', aborted, { once: true });
      current.promise.then(token => finish(undefined, token), error => finish(error));
      if (signal.aborted) aborted();
    });
  }

  private async fetchToken(profile: Extract<AuthConfig, { type: 'oauth2' }>, signal: AbortSignal): Promise<Token> {
    const value = (text: string): string => renderString(text, {}, this.env);
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (profile.scopes.length) body.set('scope', profile.scopes.join(' '));
    const headers = new AxiosHeaders({ 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
    if (profile.tokenAuthMethod === 'basic') {
      const encode = (text: string): string => new URLSearchParams({ v: text }).toString().slice(2);
      const credentials = `${encode(value(profile.clientId))}:${encode(value(profile.clientSecret))}`;
      headers.set('Authorization', `Basic ${Buffer.from(credentials).toString('base64')}`);
    } else {
      body.set('client_id', value(profile.clientId));
      body.set('client_secret', value(profile.clientSecret));
    }
    try {
      const response = await axios.post<unknown>(value(profile.tokenUrl), body.toString(), {
        headers, signal, timeout: profile.timeoutMs, maxRedirects: 0, maxContentLength: 65536,
        maxBodyLength: 65536, proxy: false, validateStatus: status => status >= 200 && status < 300,
      });
      if (!response.data || typeof response.data !== 'object') throw new Error('invalid');
      const data = response.data as Record<string, unknown>;
      if (typeof data.access_token !== 'string' || !data.access_token || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer') throw new Error('invalid');
      const ttl = typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in * 1000 : 0;
      return { value: data.access_token, expiresAt: Date.now() + ttl - Math.min(30000, ttl * 0.1) };
    } catch { throw new SidecarError('auth', 'Could not obtain a valid OAuth2 token. Check the credentials, scopes, and endpoint.'); }
  }
}
