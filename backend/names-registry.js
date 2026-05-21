'use strict';

function normalizeNameEntry(value, fallbackType = null) {
  if (typeof value === 'string') {
    return { label: value, type: fallbackType || null };
  }
  if (value && typeof value === 'object') {
    return {
      label: value.label || value.name || '',
      type: value.type || fallbackType || null,
    };
  }
  return { label: '', type: fallbackType || null };
}

function getNameLabel(registry, id, fallback = null) {
  const entry = normalizeNameEntry(registry?.[id]);
  return entry.label || fallback || id;
}

function getNameType(registry, id, fallback = null) {
  const entry = normalizeNameEntry(registry?.[id], fallback);
  return entry.type || fallback || null;
}

function setNameEntry(registry, id, label, type) {
  registry[id] = {
    label: label || id,
    type: type || null,
  };
  return registry[id];
}

function cleanNameLabels(registry) {
  const clean = {};
  for (const [id, value] of Object.entries(registry || {})) {
    if (id.startsWith('_')) continue;
    clean[id] = getNameLabel(registry, id, id);
  }
  return clean;
}

function cleanTypedNames(registry) {
  const clean = {};
  for (const [id, value] of Object.entries(registry || {})) {
    if (id.startsWith('_')) continue;
    clean[id] = normalizeNameEntry(value);
  }
  return clean;
}

module.exports = {
  normalizeNameEntry,
  getNameLabel,
  getNameType,
  setNameEntry,
  cleanNameLabels,
  cleanTypedNames,
};
