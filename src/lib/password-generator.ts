/**
 * Password generation + strength estimation backing the Password Manager's
 * Advanced Password Generator (Random / Memorable passphrase / Rhythm).
 *
 * Every generator draws from `crypto.getRandomValues` with rejection-aware
 * sampling so character choice is cryptographically secure and unbiased
 * (no modulo bias). Nothing is ever sent off device.
 *
 * Passphrase wordlist: EFF short wordlist #1 (1296 entries minus hyphenated
 * words) — https://www.eff.org/dice, EFF, CC BY 3.0 US.
 */

/* ------------------------- Cryptographic randomness ------------------------- */

const UINT32_LIMIT = 0x100000000;

/** Secure integer in [0, maxExclusive) using rejection sampling (no modulo bias). */
function secureBelow(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const bound = Math.floor(UINT32_LIMIT / maxExclusive) * maxExclusive;
  const bucket = new Uint32Array(1);
  do {
    crypto.getRandomValues(bucket);
  } while (bucket[0] >= bound);
  return bucket[0] % maxExclusive;
}

const pickChar = (pool: string): string => pool[secureBelow(pool.length)];

const pickOf = <T>(items: readonly T[]): T => items[secureBelow(items.length)];

/** Fisher–Yates shuffle driven by the secure generator. */
function secureShuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = secureBelow(index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

/** Insert an item at a uniformly random position (0..length inclusive). */
function insertAtRandom<T>(items: T[], item: T): T[] {
  const copy = [...items];
  copy.splice(secureBelow(copy.length + 1), 0, item);
  return copy;
}

/* -------------------------------- Character sets ---------------------------- */

const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+";
const AMBIGUOUS = new Set(["l", "1", "I", "O", "0", "o", "|"]);

const stripAmbiguous = (chars: string): string =>
  chars
    .split("")
    .filter((char) => !AMBIGUOUS.has(char))
    .join("");

/* ------------------------------ Random password ----------------------------- */

export interface RandomOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export function generateRandom(options: RandomOptions): string {
  let classes: string[] = [];
  if (options.lower) classes.push(LOWER);
  if (options.upper) classes.push(UPPER);
  if (options.digits) classes.push(DIGITS);
  if (options.symbols) classes.push(SYMBOLS);
  classes = (options.excludeAmbiguous ? classes.map(stripAmbiguous) : classes).filter(Boolean);
  if (classes.length === 0) return "";
  const length = Math.min(64, Math.max(classes.length, Math.round(options.length) || 8));
  const pool = classes.join("");
  // Guarantee at least one character from every selected class, then shuffle
  // so the guaranteed characters land at unpredictable positions.
  const characters = classes.map(pickChar);
  while (characters.length < length) characters.push(pickChar(pool));
  return secureShuffle(characters).join("");
}

/* --------------------------- Memorable passphrase --------------------------- */

export type PassphraseCapitalization = "lower" | "capital" | "upper";
export type PassphraseSeparator = "-" | "_" | "." | " " | "random";

export interface MemorableOptions {
  wordCount: number;
  capitalization: PassphraseCapitalization;
  separator: PassphraseSeparator;
  addNumber: boolean;
  addSymbol: boolean;
}

export function generateMemorable(options: MemorableOptions): string {
  const wordCount = Math.min(8, Math.max(2, Math.round(options.wordCount) || 4));
  const casing = (word: string): string =>
    options.capitalization === "upper"
      ? word.toUpperCase()
      : options.capitalization === "capital"
        ? word[0].toUpperCase() + word.slice(1)
        : word;
  const gapChoices = ["-", "_", "."] as const;
  const separatorOf = (): string => (options.separator === "random" ? pickOf(gapChoices) : options.separator);

  const parts: Array<{ kind: "word" | "gap" | "number" | "symbol"; value: string }> = [];
  for (let index = 0; index < wordCount; index += 1) {
    parts.push({ kind: "word", value: casing(pickOf(WORDS)) });
    if (index < wordCount - 1) parts.push({ kind: "gap", value: separatorOf() });
  }
  if (options.addNumber) {
    // Two digits add ~6.6 bits and stay easy to recall.
    const numberPlacement = secureBelow(parts.length + 1);
    parts.splice(numberPlacement, 0, { kind: "number", value: String(secureBelow(90) + 10) });
  }
  if (options.addSymbol) {
    const safe = "!@#$%&";
    parts.splice(secureBelow(parts.length + 1), 0, { kind: "symbol", value: safe[secureBelow(safe.length)] });
  }
  return parts.map((part) => part.value).join("");
}

/* ------------------------------ Rhythm password ----------------------------- */

const ONSETS = [
  "b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "y", "z",
  "bl", "br", "ch", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "ph", "pl", "pr",
  "sc", "sh", "sk", "sl", "sm", "sn", "sp", "st", "sw", "th", "tr", "tw", "wh",
] as const;
const NUCLEI = ["a", "e", "i", "o", "u", "ai", "ea", "ee", "ie", "oa", "oo", "ou"] as const;
const CODAS = [
  "", "", "", // keep vowel-only syllables common and singable
  "b", "d", "g", "k", "l", "m", "n", "p", "r", "s", "t", "x",
  "ck", "ff", "ll", "nd", "ng", "nk", "nt", "rk", "rm", "rn", "rt", "ss", "st",
] as const;
const RHYTHM_CONSONANTS = "bcdfghjklmnpqrstvwxz";
const RHYTHM_VOWELS = "aeiou";

export type RhythmPattern = "syllable" | "alternating";

export interface RhythmOptions {
  length: number;
  pattern: RhythmPattern;
  capitalize: boolean;
  addNumber: boolean;
  addSymbol: boolean;
}

/**
 * Pronounceable, rhythmic passwords built from consonant–vowel syllables.
 * Pronounceability trades some entropy for memorability — the strength meter
 * accounts for that structured-stream cost, so a rhythm password always scores
 * below a fully random string of the same length, which is the honest result.
 */
export function generateRhythm(options: RhythmOptions): string {
  const target = Math.min(24, Math.max(6, Math.round(options.length) || 12));
  let text = "";
  if (options.pattern === "alternating") {
    const startWithVowel = secureBelow(2) === 0;
    for (let index = 0; index < target; index += 1) {
      const useVowel = index % 2 === (startWithVowel ? 0 : 1);
      text += pickChar(useVowel ? RHYTHM_VOWELS : RHYTHM_CONSONANTS);
    }
  } else {
    // Recompose a handful of times until the vowel share is comfortable for
    // pronouncing aloud; truncation to the target length can otherwise shave
    // off a nucleus and leave a dense consonant run.
    for (let attempt = 0; attempt < 6; attempt += 1) {
      text = "";
      while (text.length < target) {
        let syllable = pickOf(ONSETS) + pickOf(NUCLEI);
        if (secureBelow(5) < 2) syllable += pickOf(CODAS);
        text += syllable.slice(0, target - text.length); // a partial trailing syllable stays well-formed
      }
      const vowelShare = (text.match(/[aeiou]/g) || []).length / text.length;
      if (vowelShare >= 0.28 && vowelShare <= 0.72) break;
    }
  }
  let result = text.split("");
  if (options.capitalize && result.length > 0) result[0] = result[0].toUpperCase();
  if (options.addNumber) result = insertAtRandom(result, pickChar(DIGITS));
  if (options.addSymbol) result = insertAtRandom(result, pickChar("!@#$%&"));
  return result.join("");
}

/* ------------------------------- Password data ------------------------------ */

/*************************************************************/
export const WORDS: readonly string[] = Object.freeze([
  "acid", "acorn", "acre", "acts", "afar", "affix", "aged", "agent", "agile", "aging", "agony", 
  "ahead", "aide", "aids", "aim", "ajar", "alarm", "alias", "alibi", "alien", "alike", "alive", 
  "aloe", "aloft", "aloha", "alone", "amend", "amino", "ample", "amuse", "angel", "anger", "angle", 
  "ankle", "apple", "april", "apron", "aqua", "area", "arena", "argue", "arise", "armed", "armor", 
  "army", "aroma", "array", "arson", "art", "ashen", "ashes", "atlas", "atom", "attic", "audio", 
  "avert", "avoid", "awake", "award", "awoke", "axis", "bacon", "badge", "bagel", "baggy", "baked", 
  "baker", "balmy", "banjo", "barge", "barn", "bash", "basil", "bask", "batch", "bath", "baton", 
  "bats", "blade", "blank", "blast", "blaze", "bleak", "blend", "bless", "blimp", "blink", "bloat", 
  "blob", "blog", "blot", "blunt", "blurt", "blush", "boast", "boat", "body", "boil", "bok", 
  "bolt", "boned", "boney", "bonus", "bony", "book", "booth", "boots", "boss", "botch", "both", 
  "boxer", "breed", "bribe", "brick", "bride", "brim", "bring", "brink", "brisk", "broad", "broil", 
  "broke", "brook", "broom", "brush", "buck", "bud", "buggy", "bulge", "bulk", "bully", "bunch", 
  "bunny", "bunt", "bush", "bust", "busy", "buzz", "cable", "cache", "cadet", "cage", "cake", 
  "calm", "cameo", "canal", "candy", "cane", "canon", "cape", "card", "cargo", "carol", "carry", 
  "carve", "case", "cash", "cause", "cedar", "chain", "chair", "chant", "chaos", "charm", "chase", 
  "cheek", "cheer", "chef", "chess", "chest", "chew", "chief", "chili", "chill", "chip", "chomp", 
  "chop", "chow", "chuck", "chump", "chunk", "churn", "chute", "cider", "cinch", "city", "civic", 
  "civil", "clad", "claim", "clamp", "clap", "clash", "clasp", "class", "claw", "clay", "clean", 
  "clear", "cleat", "cleft", "clerk", "click", "cling", "clink", "clip", "cloak", "clock", "clone", 
  "cloth", "cloud", "clump", "coach", "coast", "coat", "cod", "coil", "coke", "cola", "cold", 
  "colt", "coma", "come", "comic", "comma", "cone", "cope", "copy", "coral", "cork", "cost", "cot", 
  "couch", "cough", "cover", "cozy", "craft", "cramp", "crane", "crank", "crate", "crave", "crawl", 
  "crazy", "creme", "crepe", "crept", "crib", "cried", "crisp", "crook", "crop", "cross", "crowd", 
  "crown", "crumb", "crush", "crust", "cub", "cult", "cupid", "cure", "curl", "curry", "curse", 
  "curve", "curvy", "cushy", "cut", "cycle", "dab", "dad", "daily", "dairy", "daisy", "dance", 
  "dandy", "darn", "dart", "dash", "data", "date", "dawn", "deaf", "deal", "dean", "debit", "debt", 
  "debug", "decaf", "decal", "decay", "deck", "decor", "decoy", "deed", "delay", "denim", "dense", 
  "dent", "depth", "derby", "desk", "dial", "diary", "dice", "dig", "dill", "dime", "dimly", 
  "diner", "dingy", "disco", "dish", "disk", "ditch", "ditzy", "dizzy", "dock", "dodge", "doing", 
  "doll", "dome", "donor", "donut", "dose", "dot", "dove", "down", "dowry", "doze", "drab", 
  "drama", "drank", "draw", "dress", "dried", "drift", "drill", "drive", "drone", "droop", "drove", 
  "drown", "drum", "dry", "duck", "duct", "dude", "dug", "duke", "duo", "dusk", "dust", "duty", 
  "dwarf", "dwell", "eagle", "early", "earth", "easel", "east", "eaten", "eats", "ebay", "ebony", 
  "ebook", "echo", "edge", "eel", "eject", "elbow", "elder", "elf", "elk", "elm", "elope", "elude", 
  "elves", "email", "emit", "empty", "emu", "enter", "entry", "envoy", "equal", "erase", "error", 
  "erupt", "essay", "etch", "evade", "even", "evict", "evil", "evoke", "exact", "exit", "fable", 
  "faced", "fact", "fade", "fall", "false", "fancy", "fang", "fax", "feast", "feed", "femur", 
  "fence", "fend", "ferry", "fetal", "fetch", "fever", "fiber", "fifth", "fifty", "film", "filth", 
  "final", "finch", "fit", "five", "flag", "flaky", "flame", "flap", "flask", "fled", "flick", 
  "fling", "flint", "flip", "flirt", "float", "flock", "flop", "floss", "flyer", "foam", "foe", 
  "fog", "foil", "folic", "folk", "food", "fool", "found", "fox", "foyer", "frail", "frame", 
  "fray", "fresh", "fried", "frill", "frisk", "from", "front", "frost", "froth", "frown", "froze", 
  "fruit", "gag", "gains", "gala", "game", "gap", "gas", "gave", "gear", "gecko", "geek", "gem", 
  "genre", "gift", "gig", "gills", "given", "giver", "glad", "glass", "glide", "gloss", "glove", 
  "glow", "glue", "goal", "going", "golf", "gong", "good", "gooey", "goofy", "gore", "gown", 
  "grab", "grain", "grant", "grape", "graph", "grasp", "grass", "grave", "gravy", "gray", "green", 
  "greet", "grew", "grid", "grief", "grill", "grip", "grit", "groom", "grope", "growl", "grub", 
  "grunt", "guide", "gulf", "gulp", "gummy", "guru", "gush", "gut", "guy", "habit", "half", "halo", 
  "halt", "happy", "harm", "hash", "hasty", "hatch", "hate", "haven", "hazel", "hazy", "heap", 
  "heat", "heave", "hedge", "hefty", "help", "herbs", "hers", "hub", "hug", "hula", "hull", 
  "human", "humid", "hump", "hung", "hunk", "hunt", "hurry", "hurt", "hush", "hut", "ice", "icing", 
  "icon", "icy", "igloo", "image", "ion", "iron", "islam", "issue", "item", "ivory", "ivy", "jab", 
  "jam", "jaws", "jazz", "jeep", "jelly", "jet", "jiffy", "job", "jog", "jolly", "jolt", "jot", 
  "joy", "judge", "juice", "juicy", "july", "jumbo", "jump", "junky", "juror", "jury", "keep", 
  "keg", "kept", "kick", "kilt", "king", "kite", "kitty", "kiwi", "knee", "knelt", "koala", "kung", 
  "ladle", "lady", "lair", "lake", "lance", "land", "lapel", "large", "lash", "lasso", "last", 
  "latch", "late", "lazy", "left", "legal", "lemon", "lend", "lens", "lent", "level", "lever", 
  "lid", "life", "lift", "lilac", "lily", "limb", "limes", "line", "lint", "lion", "lip", "list", 
  "lived", "liver", "lunar", "lunch", "lung", "lurch", "lure", "lurk", "lying", "lyric", "mace", 
  "maker", "malt", "mama", "mango", "manor", "many", "map", "march", "mardi", "marry", "mash", 
  "match", "mate", "math", "moan", "mocha", "moist", "mold", "mom", "moody", "mop", "morse", 
  "most", "motor", "motto", "mount", "mouse", "mousy", "mouth", "move", "movie", "mower", "mud", 
  "mug", "mulch", "mule", "mull", "mumbo", "mummy", "mural", "muse", "music", "musky", "mute", 
  "nacho", "nag", "nail", "name", "nanny", "nap", "navy", "near", "neat", "neon", "nerd", "nest", 
  "net", "next", "niece", "ninth", "nutty", "oak", "oasis", "oat", "ocean", "oil", "old", "olive", 
  "omen", "onion", "only", "ooze", "opal", "open", "opera", "opt", "otter", "ouch", "ounce", 
  "outer", "oval", "oven", "owl", "ozone", "pace", "pagan", "pager", "palm", "panda", "panic", 
  "pants", "panty", "paper", "park", "party", "pasta", "patch", "path", "patio", "payer", "pecan", 
  "penny", "pep", "perch", "perky", "perm", "pest", "petal", "petri", "petty", "photo", "plank", 
  "plant", "plaza", "plead", "plot", "plow", "pluck", "plug", "plus", "poach", "pod", "poem", 
  "poet", "pogo", "point", "poise", "poker", "polar", "polio", "polka", "polo", "pond", "pony", 
  "poppy", "pork", "poser", "pouch", "pound", "pout", "power", "prank", "press", "print", "prior", 
  "prism", "prize", "probe", "prong", "proof", "props", "prude", "prune", "pry", "pug", "pull", 
  "pulp", "pulse", "puma", "punch", "punk", "pupil", "puppy", "purr", "purse", "push", "putt", 
  "quack", "quake", "query", "quiet", "quill", "quilt", "quit", "quota", "quote", "rabid", "race", 
  "rack", "radar", "radio", "raft", "rage", "raid", "rail", "rake", "rally", "ramp", "ranch", 
  "range", "rank", "rant", "rash", "raven", "reach", "react", "ream", "rebel", "recap", "relax", 
  "relay", "relic", "remix", "repay", "repel", "reply", "rerun", "reset", "rhyme", "rice", "rich", 
  "ride", "rigid", "rigor", "rinse", "riot", "ripen", "rise", "risk", "ritzy", "rival", "river", 
  "roast", "robe", "robin", "rock", "rogue", "roman", "romp", "rope", "rover", "royal", "ruby", 
  "rug", "ruin", "rule", "runny", "rush", "rust", "rut", "sadly", "sage", "said", "saint", "salad", 
  "salon", "salsa", "salt", "same", "sandy", "santa", "satin", "sauna", "saved", "savor", "sax", 
  "say", "scale", "scam", "scan", "scare", "scarf", "scary", "scoff", "scold", "scoop", "scoot", 
  "scope", "score", "scorn", "scout", "scowl", "scrap", "scrub", "scuba", "scuff", "sect", "sedan", 
  "self", "send", "sepia", "serve", "set", "seven", "shack", "shade", "shady", "shaft", "shaky", 
  "sham", "shape", "share", "sharp", "shed", "sheep", "sheet", "shelf", "shell", "shine", "shiny", 
  "ship", "shirt", "shock", "shop", "shore", "shout", "shove", "shown", "showy", "shred", "shrug", 
  "shun", "shush", "shut", "shy", "sift", "silk", "silly", "silo", "sip", "siren", "sixth", "size", 
  "skate", "skew", "skid", "skier", "skies", "skip", "skirt", "skit", "sky", "slab", "slack", 
  "slain", "slam", "slang", "slash", "slate", "slaw", "sled", "sleek", "sleep", "sleet", "slept", 
  "slice", "slick", "slimy", "sling", "slip", "slit", "slob", "slot", "slug", "slum", "slurp", 
  "slush", "small", "smash", "smell", "smile", "smirk", "smog", "snack", "snap", "snare", "snarl", 
  "sneak", "sneer", "sniff", "snore", "snort", "snout", "snowy", "snub", "snuff", "speak", "speed", 
  "spend", "spent", "spew", "spied", "spill", "spiny", "spoil", "spoke", "spoof", "spool", "spoon", 
  "sport", "spot", "spout", "spray", "spree", "spur", "squad", "squat", "squid", "stack", "staff", 
  "stage", "stain", "stall", "stamp", "stand", "stank", "stark", "start", "stash", "state", 
  "stays", "steam", "steep", "stem", "step", "stew", "stick", "sting", "stir", "stock", "stole", 
  "stomp", "stony", "stood", "stool", "stoop", "stop", "storm", "stout", "stove", "straw", "stray", 
  "strut", "stuck", "stud", "stuff", "stump", "stung", "stunt", "suds", "sugar", "sulk", "surf", 
  "sushi", "swab", "swan", "swarm", "sway", "swear", "sweat", "sweep", "swell", "swept", "swim", 
  "swing", "swipe", "swirl", "swoop", "swore", "syrup", "tacky", "taco", "tag", "take", "tall", 
  "talon", "tamer", "tank", "taper", "taps", "tarot", "tart", "task", "taste", "tasty", "taunt", 
  "thank", "thaw", "theft", "theme", "thigh", "thing", "think", "thong", "thorn", "those", "throb", 
  "thud", "thumb", "thump", "thus", "tiara", "tidal", "tidy", "tiger", "tile", "tilt", "tint", 
  "tiny", "trace", "track", "trade", "train", "trait", "trap", "trash", "tray", "treat", "tree", 
  "trek", "trend", "trial", "tribe", "trick", "trio", "trout", "truce", "truck", "trump", "trunk", 
  "try", "tug", "tulip", "tummy", "turf", "tusk", "tutor", "tutu", "tux", "tweak", "tweet", 
  "twice", "twine", "twins", "twirl", "twist", "uncle", "uncut", "undo", "unify", "union", "unit", 
  "untie", "upon", "upper", "urban", "used", "user", "usher", "utter", "value", "vapor", "vegan", 
  "venue", "verse", "vest", "veto", "vice", "video", "view", "viral", "virus", "visa", "visor", 
  "vixen", "vocal", "voice", "void", "volt", "voter", "vowel", "wad", "wafer", "wager", "wages", 
  "wagon", "wake", "walk", "wand", "wasp", "watch", "water", "wavy", "wheat", "whiff", "whole", 
  "whoop", "wick", "widen", "widow", "width", "wife", "wifi", "wilt", "wimp", "wind", "wing", 
  "wink", "wipe", "wired", "wiry", "wise", "wish", "wispy", "wok", "wolf", "womb", "wool", "woozy", 
  "word", "work", "worry", "wound", "woven", "wrath", "wreck", "wrist", "xerox", "yahoo", "yam", 
  "yard", "year", "yeast", "yelp", "yield", "yodel", "yoga", "yoyo", "yummy", "zebra", "zero", 
  "zesty", "zippy", "zone", "zoom", 
]);

const WORD_SET = new Set(WORDS);

const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "111111", "12345", "123456", "1234567", "12345678", "123456789", "1234567890", "123qwe", 
  "1q2w3e", "1qaz2wsx", "abc123", "admin", "admin123", "andrew", "angel", "apple", "asdf1234", 
  "asdfgh", "ashley", "autumn", "babygirl", "banana", "baseball", "batman", "bigdog", "boston", 
  "bubbles", "buster", "caesar", "caramel", "charlie", "cheese", "chrome", "computer", "cookie", 
  "cookie1", "corvette", "dallas", "daniel", "demo", "diamond", "donald", "dragon", "explorer", 
  "facebook", "flower", "football", "freedom", "george", "ginger", "gmail", "google", "grape", 
  "guest", "guitar", "hammer", "harley", "hello", "hockey", "hotmail", "hottie", "hunter", 
  "iloveyou", "instagram", "internet", "jessica", "jordan", "joshua", "killer", "letmein", 
  "letmein123", "linkedin", "login", "london", "lovely", "loveme", "maggie", "mango", "master", 
  "matthew", "maximus", "michael", "michelle", "minecraft", "monkey", "monkey1", "mustang", 
  "naruto", "ninja", "orange", "outlook", "p@ssw0rd", "p@ssword", "pa55w0rd", "paris", "passw0rd", 
  "password", "password1", "password123", "peanut", "pepper", "persora", "pokemon", "porsche", 
  "pretty", "princess", "princess1", "purplebool", "qazwsx", "qwe123", "qwerty", "qwerty123", 
  "ranger", "robert", "root", "sex", "shadow", "shadow1", "silver", "soccer", "solo", "spring", 
  "starwars", "summer", "sunshine", "superman", "sweetie", "test", "thomas", "tiger", "tigger2", 
  "trustno1", "twitter", "user", "welcome", "welcome1", "welcome123", "whatever", "winter", 
  "yahoo", "youtube", "zaq1zaq1", "zxcvbn", 
]);

/* ------------------------------- Strength meter ----------------------------- */

export type StrengthLevel = "weak" | "fair" | "strong" | "very-strong";

export interface StrengthReport {
  /** One of the four labelled levels shown in the UI. */
  level: StrengthLevel;
  /** 0–3, the number of filled meter segments is index + 1. */
  index: 0 | 1 | 2 | 3;
  label: string;
  /** Roughly estimated entropy in bits after pattern penalties. */
  bits: number;
  /** True when the value matches (or reduces to) a known common password. */
  common: boolean;
  /** What the estimate found. */
  issues: string[];
  /** Actionable guidance, worst first. Always at least one entry. */
  tips: string[];
}

export const STRENGTH_LEVELS: ReadonlyArray<{ id: StrengthLevel; label: string }> = [
  { id: "weak", label: "Weak" },
  { id: "fair", label: "Fair" },
  { id: "strong", label: "Strong" },
  { id: "very-strong", label: "Very strong" },
];

const LEET: Record<string, string> = { "4": "a", "0": "o", "3": "e", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

const classBits = (password: string) => {
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  const charset =
    (hasLower ? 26 : 0) + (hasUpper ? 26 : 0) + (hasDigit ? 10 : 0) + (hasSymbol ? 32 : 0);
  return { hasLower, hasUpper, hasDigit, hasSymbol, classCount, charset };
};

/** Normalise the way crackers do: lowercase + undo common leet substitutions. */
const crackNormalize = (password: string): string =>
  password
    .toLowerCase()
    .split("")
    .map((char) => LEET[char] ?? char)
    .join("");

/** Count overlapping 3-char windows that climb/descend alphabetically or follow a keyboard row. */
function countSequences(password: string): number {
  const lower = password.toLowerCase();
  let count = 0;
  for (let index = 0; index + 2 < lower.length; index += 1) {
    const a = lower.charCodeAt(index);
    const b = lower.charCodeAt(index + 1);
    const c = lower.charCodeAt(index + 2);
    const isAlphabetic = (char: number) => char >= 97 && char <= 122;
    const isDigit = (char: number) => char >= 48 && char <= 57;
    const unitStep =
      (isAlphabetic(a) || isDigit(a)) && b - a === 1 && c - b === 1;
    const unitStepDown =
      (isAlphabetic(a) || isDigit(a)) && b - a === -1 && c - b === -1;
    const row =
      lower[index] + lower[index + 1] + lower[index + 2];
    const onKeyboard = KEYBOARD_ROWS.some((keys) => keys.includes(row) || keys.includes([...row].reverse().join("")));
    if (unitStep || unitStepDown || onKeyboard) count += 1;
  }
  return count;
}

/** True when any 3–8 char chunk repeats elsewhere in the value. */
function hasRepeatedChunk(password: string): boolean {
  for (let size = 3; size <= Math.min(8, Math.floor(password.length / 2)); size += 1) {
    const seen = new Set<string>();
    for (let index = 0; index + size <= password.length; index += 1) {
      const chunk = password.slice(index, index + size).toLowerCase();
      if (seen.has(chunk)) return true;
      seen.add(chunk);
    }
  }
  return false;
}

export interface StrengthContext {
  /** Hint from the generator so structured outputs are scored honestly. */
  kind?: "passphrase" | "pronounceable";
}

/**
 * Estimate strength the way the meter explains it: entropy from length and
 * character diversity, minus honest penalties for predictable sequences,
 * keyboard walks, repetition, dates and known common-password patterns.
 * Character diversity alone cannot make a common or patterned password strong.
 */
export function evaluateStrength(password: string, context: StrengthContext = {}): StrengthReport {
  const issues: string[] = [];
  const tips: string[] = [];
  if (!password) {
    return {
      level: "weak",
      index: 0,
      label: "Weak",
      bits: 0,
      common: false,
      issues: [],
      tips: ["Generate a password to see its strength here."],
    };
  }

  const { hasLower, hasUpper, hasDigit, hasSymbol, classCount, charset } = classBits(password);
  let bits = password.length * Math.log2(Math.max(charset, 1));

  // A passphrase gets its entropy from the words, not per-character capacity.
  const letters = password.replace(/[^A-Za-z]+/g, " ").trim();
  const segments = letters.split(/\s+/).filter((segment) => segment.length >= 2);
  const looksLikeWords =
    segments.length >= 2 &&
    segments.every((segment) => WORD_SET.has(segment.toLowerCase()));
  if (context.kind === "passphrase" || looksLikeWords) {
    const extras =
      (/[A-Z]/.test(password) ? 1.6 : 0) + // casing possibilities per word, conservatively
      (/[^A-Za-z0-9\-._\s]/.test(password) ? 3.2 : 0) +
      (/\d/.test(password) ? 6.6 : 0) +
      (new Set((password.match(/[^A-Za-z0-9]/g) ?? [])).size > 1 ? 4 : 0);
    bits = segments.length * Math.log2(WORDS.length) + extras;
  } else if (context.kind === "pronounceable") {
    // Syllable streams carry ~3.4 bits per letter — honest cap for pronounceable.
    const lettersOnly = password.replace(/[^A-Za-z]/g, "").length;
    bits = Math.min(bits, lettersOnly * 3.4 + (hasDigit ? 3.3 : 0) + (hasSymbol ? 3.8 : 0) + (hasUpper ? 1 : 0));
  }

  // Penalties independent of the generation mode. A long value built from a
  // tiny alphabet of distinct characters has nowhere near its naive entropy.
  const distinctCount = new Set(password.toLowerCase()).size;
  if (distinctCount < 4) {
    bits = Math.min(bits, distinctCount * 4 + password.length * Math.log2(Math.max(distinctCount, 1)) * 0.35);
    issues.push("Uses very few different characters");
    tips.push("Use a wider mix of different characters.");
  }
  const sequences = countSequences(password);
  if (sequences > 0) {
    bits -= Math.min(sequences * 5, 20);
    issues.push(sequences > 2 ? "Runs of ordered characters like abc or 123" : "An ordered run like abc / 123 / qwe");
    tips.push("Break up sequences — abc, 123 and keyboard rows are cracked first.");
  }
  const runMatch = password.match(/(.)\1\1+/u);
  if (runMatch) {
    bits -= 8;
    issues.push(`Repeats “${runMatch[0][0]}” several times in a row`);
    tips.push("Avoid repeating the same character several times in a row.");
  }
  if (hasRepeatedChunk(password)) {
    bits -= 8;
    issues.push("Repeats a chunk of characters");
    tips.push("Avoid repeating the same chunk (e.g. abcabc).");
  }
  if (/(19|20)\d{2}/.test(password)) {
    bits -= 6;
    issues.push("Contains a year-like number");
    tips.push("Years and dates are among the first guesses.");
  }
  if (password.length < 10) {
    bits -= 6;
    tips.push("Aim for at least 12 characters — more for important accounts.");
  } else if (password.length < 14 && context.kind !== "pronounceable") {
    tips.push("A little more length makes it harder to brute-force.");
  }
  if (classCount === 1) bits -= 8;
  if (classCount < 3 && context.kind !== "passphrase") {
    const missing = [!hasDigit && "numbers", !hasSymbol && "symbols like ! or %", !hasUpper && "uppercase letters", !hasLower && "lowercase letters"].filter(Boolean);
    if (missing.length > 0) tips.push(`Mix in ${missing.slice(0, 2).join(" and ")} for more variety.`);
  }

  // Known common-password detection — this always dominates the verdict.
  // Check several attacker-style normalisations: raw, edge-stripped (drops
  // padding like "qwerty123!" or "letmein99"), and leet-undo (p@ssw0rd).
  const stripEdgeNoise = (value: string): string => value.replace(/^[^a-z]+/, "").replace(/[^a-z]+$/, "");
  const lower = password.toLowerCase();
  const leetFree = crackNormalize(lower);
  const common = [lower, stripEdgeNoise(lower), leetFree, stripEdgeNoise(leetFree)]
    .some((candidate) => candidate.length >= 2 && COMMON_PASSWORDS.has(candidate));
  bits = Math.max(4, Math.min(Math.round(bits), 160));

  let index: 0 | 1 | 2 | 3;
  if (common) index = 0;
  else if (bits >= 85) index = 3;
  else if (bits >= 60) index = 2;
  else if (bits >= 36) index = 1;
  else index = 0;
  const meta = STRENGTH_LEVELS[index];

  if (common) {
    issues.unshift("Matches a commonly used password");
    tips.unshift("This is a very common password — attackers try it first. Generate another.");
  }
  if (index === 3) {
    tips.unshift("Excellent — this is hard to guess. Save it before closing.");
  } else if (index === 2 && tips.length === 0) {
    tips.push("Solid. For the strongest result, add length or another character type.");
  } else if (index === 1) {
    tips.push("Not far off — more words, length, or character types will raise it.");
  } else if (index === 0 && !common && tips.length === 0) {
    tips.push("Too easy to guess — regenerate with more length and character types.");
  }

  return { level: meta.id, index, label: meta.label, bits, common, issues: issues.slice(0, 4), tips: Array.from(new Set(tips)).slice(0, 4) };
}

/* ───────────────────────────────────────────────────────────────────────────── */

export type GeneratorMode = "random" | "memorable" | "rhythm" | "ai";

export const GENERATOR_MODES: ReadonlyArray<{ id: GeneratorMode; label: string; caption: string }> = [
  { id: "random", label: "Random password", caption: "Maximum entropy, fully random characters" },
  { id: "memorable", label: "Memorable passphrase", caption: "Random dictionary words you can say aloud" },
  { id: "rhythm", label: "Rhythm password", caption: "Pronounceable syllables that stick in memory" },
  { id: "ai", label: "AI memorable ✦", caption: "Persora AI pairs, rhythm echoes and sonnet lines" },
];

/* ------------------------------- AI composition ----------------------------- */

export type AIPasswordStyle = "rhythmic" | "pronounceable" | "poetic" | "sonnet" | "passphrase";

export interface AIComposerOptions {
  style: AIPasswordStyle;
  /** Target overall length; the composed result lands within ±4 characters. */
  length: number;
  capitalize: boolean;
  addNumber: boolean;
  addSymbol: boolean;
}

const AI_SEPARATORS = ["-", "_", ".", " "] as const;

/**
 * Composes the final password from AI-supplied *candidates* using only
 * cryptographically secure local randomness: secure candidate selection,
 * secure ordering, separators, casing, and number/symbol insertion. The AI is
 * never a randomness source — it only supplies memorable raw material.
 */
export function composeAiPassword(candidates: readonly string[], options: AIComposerOptions): string {
  const usable = candidates
    .map((candidate) => candidate.replace(/\s+/g, " ").trim())
    .filter((candidate) => candidate.length >= 4);
  if (!usable.length) throw new Error("No usable AI password candidates.");

  const target = Math.min(64, Math.max(8, Math.round(options.length) || 16));
  const first = pickOf(usable);
  let second = "";
  if (usable.length > 1) {
    // A second phrase makes longer targets natural; only splice it in when the
    // pair can still sit near the target length.
    const others = usable.filter((candidate) => candidate !== first);
    const fits = others.filter((candidate) => candidate.length + first.length + 1 <= target + 4);
    const pool = fits.length ? fits : others;
    const candidate = pickOf(pool);
    if (candidate.length + first.length + 1 >= Math.max(10, target - 4)) second = candidate;
  }

  const joiner = second ? pickOf(AI_SEPARATORS) : "";
  const combined = (second ? `${first}${joiner}${second}` : first).replace(/\s{2,}/g, " ").trim();
  const base = combined.length > target + 4 ? combined.slice(0, target + 4).replace(/[\s._-]+$/, "") : combined;

  const words = base.split(/([\s._-]+)/).map((segment) => (/^[\s._-]+$/.test(segment) || !segment
    ? segment
    : options.capitalize
      ? segment[0].toUpperCase() + segment.slice(1)
      : segment.toLowerCase()));

  let result = words.join("").split("");
  // Spaces in passphrases read nicely, but many forms reject them — for the
  // space-separated styles swap some spaces for visible separators at random.
  if (options.style !== "passphrase") {
    result = result.map((char) => (char === " " ? (secureBelow(3) === 0 ? " " : pickOf(["-", "_", "."])) : char));
  }
  if (options.addNumber) result = insertAtRandom(result, pickChar(DIGITS));
  if (options.addSymbol) result = insertAtRandom(result, pickChar("!@#$%&"));
  if (options.capitalize && result.length && /[a-z]/.test(result[0])) result[0] = result[0].toUpperCase();
  return result.join("");
}

/** Fully local fallback used when Persora AI is offline: the same option grid
 * is routed into the built-in deterministic-quality generators so the user is
 * never blocked waiting on a model. */
export function generateAiLocalFallback(options: AIComposerOptions): string {
  if (options.style === "pronounceable" || options.style === "rhythmic") {
    return generateRhythm({
      length: options.length,
      pattern: "syllable",
      capitalize: options.capitalize,
      addNumber: options.addNumber,
      addSymbol: options.addSymbol,
    });
  }
  const wordCount = options.style === "passphrase" ? Math.max(4, Math.round(options.length / 6)) : 3;
  return generateMemorable({
    wordCount: Math.min(8, wordCount),
    separator: options.style === "passphrase" ? "-" : "random",
    capitalization: options.capitalize ? "capital" : "lower",
    addNumber: options.addNumber,
    addSymbol: options.addSymbol,
  });
}
