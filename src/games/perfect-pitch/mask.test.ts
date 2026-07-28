import { MAX_HZ, MIN_HZ, RANGE_CENTS, centsAtHz } from "./logic";
import { maskCents, roundKey, unmaskCents } from "./mask";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function createSeededRng(seed = 4242) {
  let s = seed;
  return function rng() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const RUN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

// Test 1: masking round-trips across the whole playable range
{
  const rng = createSeededRng(1);
  for (let i = 0; i < 4000; i++) {
    const cents = rng() * RANGE_CENTS;
    const salt = Math.floor(rng() * 0xffffffff).toString(16);
    const index = Math.floor(rng() * 5);
    const key = roundKey(RUN, salt, index);
    const recovered = unmaskCents(maskCents(cents, key), key);
    // Three decimal places of cents is a thousandth of a cent - far finer
    // than the ear, and finer than the ribbon can be moved.
    assert(
      Math.abs(recovered - cents) < 0.001,
      `round trip at ${cents}: got ${recovered}`,
    );
  }

  // The exact endpoints matter most - they're where an off-by-one shows up.
  for (const hz of [MIN_HZ, MAX_HZ]) {
    const cents = centsAtHz(hz);
    const key = roundKey(RUN, "deadbeef", 0);
    assert(
      Math.abs(unmaskCents(maskCents(cents, key), key) - cents) < 0.001,
      `round trip at range edge ${hz}`,
    );
  }
}

// Test 2: the masked value never resembles the thing it hides
{
  const key = roundKey(RUN, "0f0f0f0f", 2);
  let leaks = 0;
  for (let cents = 0; cents <= RANGE_CENTS; cents += 25) {
    const masked = maskCents(cents, key);
    assert(Number.isInteger(masked), "the wire value is an integer");
    assert(masked >= 0 && masked <= 0xffffffff, "and fits in a uint32");
    // A masked value that happened to land in the plausible-cents range would
    // be readable at a glance, which is the whole thing we're avoiding.
    if (masked <= RANGE_CENTS * 1000) leaks++;
  }
  assert(leaks === 0, `${leaks} masked values were small enough to read`);
}

// Test 3: the key depends on every input
{
  const base = roundKey(RUN, "aabbccdd", 0);
  assert(roundKey(RUN, "aabbccdd", 1) !== base, "a different round differs");
  assert(roundKey(RUN, "aabbccde", 0) !== base, "a different salt differs");
  assert(roundKey("f".repeat(32), "aabbccdd", 0) !== base, "a different run differs");
  assert(roundKey(RUN, "aabbccdd", 0) === base, "and it is deterministic");
  assert(base >= 0 && base <= 0xffffffff, "the key is an unsigned 32-bit value");
}

// Test 4: keys spread out rather than clustering
{
  // A weak hash would put many rounds on the same key, and one leaked pair
  // would then unmask others.
  const seen = new Set<number>();
  for (let i = 0; i < 5000; i++) {
    seen.add(roundKey(RUN, i.toString(16).padStart(8, "0"), i % 5));
  }
  assert(seen.size === 5000, `${5000 - seen.size} key collisions in 5000`);

  // Flipping one character of the salt should change roughly half the bits.
  let totalFlipped = 0;
  for (let i = 0; i < 200; i++) {
    const a = roundKey(RUN, `salt${i}a`, 0);
    const b = roundKey(RUN, `salt${i}b`, 0);
    let bits = 0;
    let diff = (a ^ b) >>> 0;
    while (diff) {
      bits += diff & 1;
      diff >>>= 1;
    }
    totalFlipped += bits;
  }
  const avg = totalFlipped / 200;
  assert(avg > 10 && avg < 22, `avalanche averaged ${avg.toFixed(1)} of 32 bits`);
}

// Test 5: the wrong key yields nonsense, not a near miss
{
  const cents = 1800;
  const right = roundKey(RUN, "12345678", 0);
  const wrong = roundKey(RUN, "12345678", 1);
  const masked = maskCents(cents, right);
  const bogus = unmaskCents(masked, wrong);
  assert(
    Math.abs(bogus - cents) > 100,
    `a wrong key must not land near the answer, got ${bogus}`,
  );
}

console.log("All Perfect Pitch mask tests passed successfully!");
