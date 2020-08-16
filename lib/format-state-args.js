'use strict';

const merge = require('deepmerge');

module.exports = scriptReader => (parent, propName) => {
  const property = parent && parent[propName] ? parent[propName] : parent;
  let result = {};
  if ('string' === typeof property) {
    let result = scriptReader.merge(property);
    if (result[propName]) {
      result = merge(result, result[propName]);
      delete result[propName];
    }
    return result;
  }
  if (Array.isArray(property)) {
    property.forEach((input, i) => {
      if ('string' === typeof input) {
        let newInputs = scriptReader.merge(input);
        if (newInputs[propName]) {
          newInputs = merge(newInputs, newInputs[propName]);
        }
        result = merge(result, newInputs);
        return;
      }
      if ('object' === typeof input) {
        if (input[propName]) {
          result = merge(result, input[propName]);
        }
        result = merge(result, input);
        return;
      }
      throw new Error(`Input ${i} had unexpected type (${typeof input}); usage --inputs.foo=bar and/or --inputs path-to-file`);
    });
    delete result[propName];
    return result;
  }
  if ('object' === typeof property) {
    return property;
  }
  return result;
};
