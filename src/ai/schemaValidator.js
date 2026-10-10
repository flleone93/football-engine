function fail(path, message) {
  const error = new Error(`${path}: ${message}`);
  error.code = 'ai_schema_validation_error';
  throw error;
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

export function assertJsonSchema(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return value;
  const acceptedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (acceptedTypes.length && !acceptedTypes.some((type) => typeMatches(value, type))) {
    fail(path, `tipo non valido; atteso ${acceptedTypes.join('|')}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) fail(path, 'valore fuori enum');

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) fail(path, 'stringa troppo corta');
    if (schema.maxLength != null && value.length > schema.maxLength) fail(path, 'stringa troppo lunga');
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) fail(path, 'valore sotto il minimo');
    if (schema.maximum != null && value > schema.maximum) fail(path, 'valore sopra il massimo');
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) fail(path, 'array troppo corto');
    if (schema.maxItems != null && value.length > schema.maxItems) fail(path, 'array troppo lungo');
    if (schema.items) value.forEach((item, index) => assertJsonSchema(item, schema.items, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) fail(path, `campo obbligatorio mancante: ${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) fail(path, `campo non ammesso: ${key}`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) assertJsonSchema(value[key], childSchema, `${path}.${key}`);
    }
  }
  return value;
}
