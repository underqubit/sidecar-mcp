/** Resolve only local JSON Pointers; never fetch files or URLs from a specification. */
export function pointer(document, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) throw new Error('Only local JSON Pointer references (#/...) are supported; bundle external references first.');
  let keys;
  try { keys = decodeURIComponent(reference.slice(2)).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~')); }
  catch { throw new Error('Invalid reference encoding.'); }
  let value = document;
  for (const key of keys) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`Unresolved reference: ${reference}`);
    value = value[key];
  }
  return value;
}

export function resolveObject(document, value, modern = false, seen = new Set()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an OpenAPI object.');
  if (!value.$ref) return value;
  if (seen.has(value.$ref)) throw new Error('Circular reference outside a schema.');
  seen.add(value.$ref);
  const resolved = resolveObject(document, pointer(document, value.$ref), modern, seen);
  const { $ref, ...siblings } = value;
  return modern ? { ...resolved, ...siblings } : resolved;
}

const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const singles = new Set(['items', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'unevaluatedItems', 'not', 'if', 'then', 'else']);
const values = new Set(['type', 'title', 'description', 'enum', 'const', 'default', 'examples', 'minimum', 'maximum', 'multipleOf', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains', 'minProperties', 'maxProperties', 'required', 'dependentRequired', 'readOnly', 'writeOnly', 'deprecated']);
const metadata = new Set(['example', 'xml', 'externalDocs', 'discriminator']);
const formats = new Set(['date', 'time', 'date-time', 'duration', 'uri', 'uri-reference', 'uri-template', 'url', 'email', 'hostname', 'ipv4', 'ipv6', 'regex', 'uuid', 'json-pointer', 'relative-json-pointer']);

/** Each input/output root gets its own definitions and read/write projection. */
export class SchemaBuilder {
  constructor(document, { modern, direction, warn }) {
    this.document = document; this.modern = modern; this.direction = direction; this.warn = warn;
    this.definitions = Object.create(null); this.references = new Map();
  }

  convert(schema = {}) {
    if (typeof schema === 'boolean') return schema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('Invalid Schema Object.');
    if (schema.type === 'file' || ['binary', 'byte'].includes(schema.format) || schema.contentEncoding || schema.contentMediaType) throw new Error('Binary/file or encoded schemas require manual mapping.');
    let converted = {};
    if (schema.$ref) {
      let key = this.references.get(schema.$ref);
      if (!key) {
        key = `schema_${this.references.size}`;
        this.references.set(schema.$ref, key);
        this.definitions[key] = {};
        this.definitions[key] = this.convert(pointer(this.document, schema.$ref));
      }
      converted.$ref = `#/$defs/${key}`;
      if (!this.modern) {
        if (Object.keys(schema).some(key => key !== '$ref')) this.warn('Schema $ref siblings are ignored under Swagger 2/OpenAPI 3.0 semantics.');
        return converted;
      }
    }
    const removed = new Set();
    for (const [key, value] of Object.entries(schema)) {
      if (key === '$ref' || key === 'nullable' || key === 'x-nullable' || key.startsWith('x-')) continue;
      if (metadata.has(key)) {
        if (key === 'discriminator') this.warn('Discriminator metadata is not used for validation; the declared schema branches are preserved.');
        continue;
      }
      if (key === 'format') {
        if (formats.has(value)) converted.format = value;
        else this.warn(`Format ${value} is omitted because the runtime does not validate it; the underlying type is preserved.`);
      } else if (maps.has(key)) {
        const entries = [];
        for (const [name, child] of Object.entries(value)) {
          if (key === 'properties') {
            const annotation = typeof child === 'boolean' ? {} : resolveObject(this.document, child, this.modern);
            if ((this.direction === 'input' && annotation.readOnly) || (this.direction === 'output' && annotation.writeOnly)) { removed.add(name); continue; }
          }
          entries.push([name, this.convert(child)]);
        }
        converted[key] = Object.fromEntries(entries);
      } else if (arrays.has(key)) converted[key] = value.map(child => this.convert(child));
      else if (singles.has(key)) converted[key] = this.convert(value);
      else if (values.has(key)) converted[key] = structuredClone(value);
      else if (key === '$schema' && ['https://json-schema.org/draft/2020-12/schema', 'https://spec.openapis.org/oas/3.1/dialect/base', 'https://spec.openapis.org/oas/3.2/dialect/base'].includes(value)) continue;
      else throw new Error(`Schema keyword ${key} is not supported; convert it to JSON Schema 2020-12 first.`);
    }
    if (converted.required) {
      converted.required = converted.required.filter(name => !removed.has(name));
      if (!converted.required.length) delete converted.required;
    }
    for (const [exclusive, inclusive] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
      if (typeof converted[exclusive] === 'boolean') {
        if (converted[exclusive]) {
          if (typeof converted[inclusive] !== 'number') throw new Error(`${exclusive} requires ${inclusive}.`);
          converted[exclusive] = converted[inclusive]; delete converted[inclusive];
        } else delete converted[exclusive];
      }
    }
    if (!this.modern && (schema.nullable === true || schema['x-nullable'] === true)) converted = { anyOf: [converted, { type: 'null' }] };
    return converted;
  }

  finish(root) {
    if (Object.keys(this.definitions).length) root.$defs = this.definitions;
    return root;
  }
}
