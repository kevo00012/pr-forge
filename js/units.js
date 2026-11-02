/* PR Forge — weight units.
 * All analytics compare and sum in pounds. Each workout stores the unit it was
 * logged in; set weights are stored in that unit.
 * Works in the browser (window.PRF.units) and in Node (module.exports). */
(function (root) {
  'use strict';

  var LB_PER_KG = 2.20462262185;

  function num(w) {
    var n = Number(w);
    return isFinite(n) ? n : 0;
  }

  function toLb(weight, unit) {
    var w = num(weight);
    return unit === 'kg' ? w * LB_PER_KG : w;
  }

  function fromLb(lb, unit) {
    var w = num(lb);
    return unit === 'kg' ? w / LB_PER_KG : w;
  }

  function convert(weight, from, to) {
    if (from === to) return num(weight);
    return fromLb(toLb(weight, from), to);
  }

  /** Format a number with at most one decimal, dropping a trailing ".0". */
  function fmtNum(n) {
    var r = Math.round(num(n) * 10) / 10;
    if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
    return r.toFixed(1);
  }

  /** Round a converted weight to something a lifter would type (0.5 steps). */
  function roundForEntry(weight) {
    return Math.round(num(weight) * 2) / 2;
  }

  function fmtWeightLb(lb, unit) {
    return fmtNum(fromLb(lb, unit)) + ' ' + unit;
  }

  function fmtVolumeLb(lb, unit) {
    var v = Math.round(fromLb(lb, unit));
    return v.toLocaleString('en-US') + ' ' + unit;
  }

  var api = {
    LB_PER_KG: LB_PER_KG,
    toLb: toLb,
    fromLb: fromLb,
    convert: convert,
    fmtNum: fmtNum,
    roundForEntry: roundForEntry,
    fmtWeightLb: fmtWeightLb,
    fmtVolumeLb: fmtVolumeLb
  };

  root.PRF = root.PRF || {};
  root.PRF.units = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
