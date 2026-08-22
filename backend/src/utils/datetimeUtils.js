/**
 * Helpers de formatage de dates compatibles MySQL.
 *
 * Contexte : SQLite acceptait `new Date().toISOString()` ("2026-08-22T16:54:59.366Z")
 * pour les colonnes DATETIME, mais MySQL (mode strict) le rejette avec
 * `Incorrect datetime value`. Ces fonctions produisent les formats natifs
 * attendus par MySQL :
 *   - colonnes DATE    -> 'YYYY-MM-DD'
 *   - colonnes DATETIME -> 'YYYY-MM-DD HH:MM:SS'
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Convertit une date JS en chaîne 'YYYY-MM-DD HH:MM:SS' (type DATETIME
 * accepté par MySQL). Utilise les composantes LOCALES de la date.
 */
function toMySQLDatetime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return [
    d.getFullYear(),
    '-',
    pad2(d.getMonth() + 1),
    '-',
    pad2(d.getDate()),
    ' ',
    pad2(d.getHours()),
    ':',
    pad2(d.getMinutes()),
    ':',
    pad2(d.getSeconds())
  ].join('');
}

/**
 * Convertit une date JS en format 'YYYY-MM-DD' (type DATE accepté par MySQL).
 * Équivalent de `date.toISOString().split('T')[0]`, mais sans l'ambiguïté
 * UTC : utilise les composantes LOCALES de la date.
 */
function toMySQLDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return [
    d.getFullYear(),
    '-',
    pad2(d.getMonth() + 1),
    '-',
    pad2(d.getDate())
  ].join('');
}

module.exports = { toMySQLDatetime, toMySQLDate };