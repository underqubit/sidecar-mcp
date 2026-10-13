import { resolve } from 'node:path';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../dist/config.js';
import { Runtime } from '../dist/runtime.js';

const origin = 'https://jira.example.test';
const email = 'reader@example.com';
const token = 'test-jira-token';
const configPath = resolve('examples/jira.json');
const active: Runtime[] = [];
const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Review this issue.' }] }] };
const user = { accountId: 'account-1', displayName: 'Reader', emailAddress: 'not-returned@example.com', avatarUrls: {} };
const issue = {
  id: '10001', key: 'DEMO-42', fields: {
    summary: 'Investigate a failure', status: { name: 'Open' }, issuetype: { name: 'Bug' },
    priority: null, assignee: null, reporter: user, description: adf,
    project: { id: '10000', key: 'DEMO', name: 'Demo' },
    created: '2026-10-01T10:00:00.000+0000', updated: '2026-10-02T10:00:00.000+0000',
    duedate: null, resolution: null, labels: [],
  },
};
function api() {
  return nock(origin, { reqheaders: { authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`, accept: 'application/json' } });
}
async function make(baseUrl = origin) {
  const loaded = await loadConfig(configPath, { JIRA_BASE_URL: baseUrl, JIRA_EMAIL: email, JIRA_API_TOKEN: token });
  const runtime = new Runtime(loaded, () => {}); active.push(runtime); return runtime;
}
beforeEach(() => nock.disableNetConnect());
afterEach(async () => {
  await Promise.all(active.splice(0).map(runtime => runtime.close()));
  nock.abortPendingRequests(); nock.cleanAll(); nock.enableNetConnect();
});

describe('Jira Cloud configuration', () => {
  it.each([0, 1, 2])('preserves search result arrays with %i items and omits the initial null cursor', async count => {
    const request = api().get('/rest/api/3/search/jql').query({
      jql: 'project = DEMO ORDER BY updated DESC', maxResults: '25',
      fields: 'summary,status,issuetype,priority,assignee,updated',
    }).reply(200, { issues: Array.from({ length: count }, () => issue), isLast: true });
    const result = await (await make()).call('jira_search_issues', { jql: 'project = DEMO ORDER BY updated DESC', maxResults: 25, nextPageToken: null });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ issues: expect.any(Array), isLast: true, nextPageToken: null });
    expect((result.structuredContent as { issues: unknown[] }).issues).toHaveLength(count);
    if (count) expect(((result.structuredContent as { issues: unknown[] }).issues as unknown[])[0]).toMatchObject({ key: 'DEMO-42', summary: issue.fields.summary, assignee: null, priority: null });
    expect(request.isDone()).toBe(true);
  });

  it('passes opaque search cursors and preserves the scoped-token gateway prefix', async () => {
    const request = api().get('/ex/jira/cloud-123/rest/api/3/search/jql').query({
      jql: 'project = DEMO', maxResults: '25', nextPageToken: 'cursor+/=',
      fields: 'summary,status,issuetype,priority,assignee,updated',
    }).reply(200, { issues: [issue], isLast: false, nextPageToken: 'next-token' });
    const result = await (await make(`${origin}/ex/jira/cloud-123`)).call('jira_search_issues', { jql: 'project = DEMO', maxResults: 25, nextPageToken: 'cursor+/=' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ nextPageToken: 'next-token', isLast: false });
    expect(request.isDone()).toBe(true);
  });

  it('returns ADF and nullable details without updating viewed history or exposing user email', async () => {
    const request = api().get('/rest/api/3/issue/DEMO-42').query({
      fields: 'summary,description,status,issuetype,priority,assignee,reporter,project,created,updated,duedate,resolution,labels', updateHistory: 'false',
    }).reply(200, issue);
    const result = await (await make()).call('jira_get_issue', { issueIdOrKey: 'DEMO-42' });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ key: 'DEMO-42', description: adf, reporter: { accountId: 'account-1', displayName: 'Reader' }, labels: [], dueDate: null, resolution: null });
    expect(JSON.stringify(result)).not.toContain(user.emailAddress);
    expect(request.isDone()).toBe(true);
  });

  it.each([0, 1, 2])('preserves comment arrays with %i items and advances by actual page length', async count => {
    const comments = Array.from({ length: count }, (_, i) => ({ id: String(i), body: adf, author: user, created: issue.fields.created, updated: issue.fields.updated }));
    const request = api().get('/rest/api/3/issue/DEMO-42/comment').query({ startAt: '0', maxResults: '25', orderBy: 'created' })
      .reply(200, { startAt: 0, maxResults: 25, total: count ? 3 : 0, comments });
    const result = await (await make()).call('jira_list_issue_comments', { issueIdOrKey: 'DEMO-42', startAt: 0, maxResults: 25 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ comments: expect.any(Array), nextStartAt: count || null, isLast: count === 0 });
    expect((result.structuredContent as { comments: unknown[] }).comments).toHaveLength(count);
    if (count) expect(((result.structuredContent as { comments: unknown[] }).comments as unknown[])[0]).toMatchObject({ body: adf });
    expect(JSON.stringify(result)).not.toContain(user.emailAddress);
    expect(request.isDone()).toBe(true);
  });

  it.each([0, 1, 2])('preserves changelog arrays with %i histories and nullable field changes', async count => {
    const values = Array.from({ length: count }, (_, i) => ({ id: String(i), author: user, created: issue.fields.created,
      items: [{ field: 'assignee', fieldtype: 'jira', from: null, fromString: null, to: 'account-1', toString: 'Reader' }],
    }));
    const request = api().get('/rest/api/3/issue/DEMO-42/changelog').query({ startAt: '0', maxResults: '25' })
      .reply(200, { startAt: 0, maxResults: 25, total: count, isLast: true, values });
    const result = await (await make()).call('jira_list_issue_changelog', { issueIdOrKey: 'DEMO-42', startAt: 0, maxResults: 25 });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ histories: expect.any(Array), isLast: true, nextStartAt: null });
    expect((result.structuredContent as { histories: unknown[] }).histories).toHaveLength(count);
    if (count) expect(((result.structuredContent as { histories: unknown[] }).histories as unknown[])[0]).toMatchObject({ items: [{ field: 'assignee', fieldId: null, from: null, fromString: null, to: 'account-1', toString: 'Reader' }] });
    expect(request.isDone()).toBe(true);
  });

  it('rejects missing pagination arguments before making a request', async () => {
    const result = await (await make()).call('jira_search_issues', { jql: 'project = DEMO', maxResults: 25 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('[input]');
  });
});
