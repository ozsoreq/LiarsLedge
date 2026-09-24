/* Liar's Ledge — tunables. Units are metres and seconds, y points up. */
(function (LL) {
  'use strict';

  LL.C = {
    SEED: 0x1ed6e,          // the wall is deterministic: everyone climbs the same lie
    WALL_HALF: 6,           // wall spans x ∈ [-6, 6]
    TOP: 600,               // real summit
    FAKE_SUMMIT: 560,       // where the credits roll
    CATCH_LEDGE: 529.5,     // where the fake summit drops you

    // physics
    DT: 1 / 120,
    ITER: 14,
    GRAVITY: 9.8,
    DAMP_AIR: 0.9994,       // per step velocity retention
    DAMP_HANG: 0.9975,      // extra drag while touching the wall with a hand
    CORE: 22,               // torso-upright spring while holding on (rad/s² per rad)

    // climber
    ARM_MAX: 1.1,           // reach from the shoulder (~1.2 torso lengths)
    ARM_MIN: 0.32,          // fully locked-off pull-up
    PULL_SPEED: 1.9,        // m/s the arm can shorten / lengthen
    WHEEL_STEP: 0.11,       // metres per wheel notch
    HAND_SPEED: 26,         // reaching hand follow rate
    CURSOR_RADIUS: 3.0,     // cursor lives within this radius of the chest
    GRIP_SLOP: 0.12,        // how far outside a hold's radius a hand still catches it
    SWING_ACCEL: 4.6,       // accel per metre of over-reach while hanging
    SWING_MAX_EXCESS: 1.5,
    CRAWL_SPEED: 1.3,       // m/s shuffling along a ledge while lying on it

    // stamina (fraction of a full bar per second)
    ONE_ARM_DRAIN: 0.085,
    TWO_ARM_DRAIN: 0.02,
    FREE_REGEN: 0.13,
    REST_REGEN: 0.5,
    PULL_COST: 0.1,         // per metre of arm shortened under load
    DRAG_COST: 0.05,        // per metre of over-reach per second
    DYNO_COST: 0.12,
    CATCH_FREE_SPEED: 3.2,  // grabbing while falling faster than this costs stamina
    CATCH_COST: 0.055,      // per m/s above that

    // dyno
    DYNO_BASE: 2.4,
    DYNO_PULL: 3.0,
    DYNO_MAX: 5.4,

    ZONES: [
      { id: 1, name: 'The Quarry',  y0: 0,   y1: 80,  accent: '#9fb7cc', sky: ['#1c2330', '#2c3747'], wall: '#5b626c', wall2: '#6c737c' },
      { id: 2, name: 'The Gallery', y0: 80,  y1: 200, accent: '#e8e2d4', sky: ['#1d2230', '#343a4a'], wall: '#62666d', wall2: '#777b82' },
      { id: 3, name: 'The Stage',   y0: 200, y1: 330, accent: '#e8a85c', sky: ['#20192a', '#3b2c3a'], wall: '#6c6158', wall2: '#7d7066' },
      { id: 4, name: 'The Glitch',  y0: 330, y1: 480, accent: '#6ff0c6', sky: ['#0d1a1e', '#16303a'], wall: '#46595c', wall2: '#566b6d' },
      { id: 5, name: 'The Summit',  y0: 480, y1: 600, accent: '#f3c56b', sky: ['#2b3350', '#c98c52'], wall: '#8a7760', wall2: '#9d896e' }
    ],

    GLOVE_L: '#ff8a5c',     // warm
    GLOVE_R: '#5cc8ff',     // cool
    BODY: '#e9e4da'
  };

  LL.zoneAt = function (y) {
    const Z = LL.C.ZONES;
    for (let i = Z.length - 1; i >= 0; i--) if (y >= Z[i].y0) return Z[i];
    return Z[0];
  };
})(globalThis.LL = globalThis.LL || {});
