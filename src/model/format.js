'use strict';

function shortId(id) {
  return id.slice(0, 13);
}

function localTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

function truncate(text, width) {
  if (!text) return '';
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '...' : text;
}

module.exports = {
  localTime,
  shortId,
  truncate,
};
