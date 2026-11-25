/* PR Forge — plate calculator. Pure functions, no DOM. */
(function (root) {
  'use strict';

  var PLATES = { lb: [45, 35, 25, 10, 5, 2.5], kg: [25, 20, 15, 10, 5, 2.5, 1.25] };
  var BAR = { lb: 45, kg: 20 };

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  /**
   * Plates per side for a target weight. Works in whole steps of the smallest plate increment,
   * always using the fewest plates. Returns null when there's no usable weight, otherwise
   * { lessThanBar } or { exact, perSide, below, above, belowPlates, abovePlates }.
   */
  function calculate(target, bar, plates) {
    var t = Number(target), b = Number(bar);
    if (!(t > 0) || !(b > 0) || t > 5000) return null;
    if (t < b) return { lessThanBar: true };
    var cents = plates.map(function (p) { return Math.round(p * 100); });
    var step = cents.reduce(gcd);
    var perSide = (Math.round(t * 100) - Math.round(b * 100)) / 2 / step;
    var maxPlate = Math.max.apply(null, cents) / step;
    var limit = Math.ceil(perSide) + maxPlate;
    var fewest = [0], from = [null];
    for (var n = 1; n <= limit; n++) {
      fewest[n] = Infinity; from[n] = null;
      for (var i = 0; i < cents.length; i++) {
        var size = cents[i] / step;
        if (size <= n && fewest[n - size] + 1 < fewest[n]) { fewest[n] = fewest[n - size] + 1; from[n] = size; }
      }
    }
    var platesFor = function (units) {
      var out = [];
      for (var u = units; u > 0; u -= from[u]) out.push(from[u] * step / 100);
      return out.sort(function (x, y) { return y - x; });
    };
    var total = function (units) { return (Math.round(b * 100) + units * step * 2) / 100; };
    if (Number.isInteger(perSide) && fewest[perSide] !== Infinity) {
      return { exact: true, perSide: platesFor(perSide), below: null, above: null, belowPlates: null, abovePlates: null };
    }
    var down = Math.floor(perSide), up = Math.ceil(perSide);
    while (down > 0 && fewest[down] === Infinity) down--;
    while (up < limit && fewest[up] === Infinity) up++;
    return { exact: false, perSide: [], below: total(down), belowPlates: platesFor(down), above: total(up), abovePlates: platesFor(up) };
  }

  /**
   * Warm-up sets for a barbell working weight (2.6.0): the empty bar for 10, then about 40%, 60% and 80% of the
   * working weight for 5, 3 and 2 reps, each rounded down to a weight the plates can make (5 lb / 2.5 kg steps).
   * Steps that land on the bar, repeat a weight, or come within one step of the working weight are left out.
   * A common general ramp, not a prescription. Returns [{ weight, reps }] (empty when there's nothing to warm up to).
   */
  function warmupPlan(work, bar, unit) {
    var w = Number(work), b = Number(bar), step = unit === 'kg' ? 2.5 : 5;
    if (!(w > 0) || !(b > 0) || w <= b) return [];
    var out = [{ weight: b, reps: 10 }];
    [[0.4, 5], [0.6, 3], [0.8, 2]].forEach(function (r) {
      var x = Math.floor((w * r[0]) / step) * step;
      if (x > out[out.length - 1].weight && x < w - step + 0.001) out.push({ weight: x, reps: r[1] });
    });
    return out;
  }

  var api = { PLATES: PLATES, BAR: BAR, calculate: calculate, warmupPlan: warmupPlan };
  root.PRF = root.PRF || {};
  root.PRF.plates = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
