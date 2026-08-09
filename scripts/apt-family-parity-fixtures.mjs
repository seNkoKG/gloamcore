const ORIGIN_CONSTRUCTED = "authoritative-format-constructed-from-pinned-database";
const ORIGIN_SANITIZED_LIVE = "sanitized-live-capture";

function normalFixture(itemClass, baseType, extraSections = []) {
  return [
    `Item Class: ${itemClass}`,
    "Rarity: Normal",
    baseType,
    "--------",
    "Item Level: 83",
    ...extraSections.flatMap((section) => ["--------", ...section]),
  ].join("\n");
}

function categoryFixture(id, category, itemClass, baseRef, raw) {
  return {
    id,
    kind: "category",
    category,
    baseRef,
    origin: ORIGIN_CONSTRUCTED,
    raw: raw ?? normalFixture(itemClass, baseRef),
  };
}

function branchFixture(id, category, raw, origin = ORIGIN_CONSTRUCTED) {
  return { id, kind: "branch", category, origin, raw };
}

const chartRaw = `Item Class: Chart
Rarity: Rare
Marine Dive
Coral Forest Chart
--------
Undersea Groves
Area Level: 69
Item Quantity: +64% (augmented)
Dead Man's Sulphur: +60% (augmented)
--------
Requirements:
Level: 54
--------
Item Level: 69
--------
Voyage Modifier will be revealed once Charted
--------
Chart Shape: Corner
--------
+9% Monster Physical Damage Reduction
Monsters are Hexproof
+13% Monster Chaos Resistance
+17% Monster Elemental Resistances
Monsters Hinder on Hit with Spells
60% increased Dead Man's Sulphur found in this Area
--------
Take this item to Valerie aboard the Sovereign to Chart this area.`;

const logbookRaw = `Item Class: Expedition Logbooks
Rarity: Normal
Expedition Logbook
--------
Area Level: 83
--------
Logbook Area:
Druids of the Broken Circle
Area contains Medved, Feller of Heroes (implicit)
Monsters have 25% increased Attack Speed
--------
Logbook Area:
Black Scythe Mercenaries
Area contains Vorana, Last to Fall (implicit)
Monsters deal 30% increased Damage
--------
Travel to this Logbook's site by using it in a personal Map Device.`;

const flaskRaw = `Item Class: Utility Flasks
Rarity: Magic
Chemist's Amethyst Flask of the Deer
--------
Lasts 6.50 Seconds
Consumes 30 of 60 Charges on use
Currently has 60 Charges
+35% to Chaos Resistance
Quality: +20% (augmented)
--------
Requirements:
Level: 18
--------
Item Level: 83
--------
{ Prefix Modifier "Chemist's" (Tier: 1) — Flask }
20(20-20)% reduced Charges per use
{ Suffix Modifier "of the Deer" (Tier: 1) — Flask }
40(36-40)% increased Evasion Rating during Effect`;

const tinctureRaw = `Item Class: Tinctures
Rarity: Magic
Perfect Ashbark Tincture of the Oak
--------
Quality: +20% (augmented)
--------
Requirements:
Level: 60
--------
Item Level: 83
--------
{ Prefix Modifier "Perfect" (Tier: 1) — Tincture }
20(18-20)% increased Cooldown Recovery Rate
{ Suffix Modifier "of the Oak" (Tier: 1) — Tincture }
15(13-15)% increased Effect`;

const tinctureBasePropertiesRaw = `Item Class: Tinctures
Rarity: Magic
Fulgurite Tincture of the Order
Fulgurite Tincture
--------
Quality: +20% (augmented)
40% increased Elemental Damage with Melee Weapons
Mana Burn causes you to lose 1% of your maximum Mana per second
--------
Requirements:
Level: 18
--------
Item Level: 86
--------
{ Suffix Modifier "of the Order" (Tier: 1) }
20% increased Cooldown Recovery Rate`;

const magebloodAdvancedRaw = `Item Class: Belts
Rarity: Unique
Mageblood
Heavy Belt
--------
Requirements:
Level: 44
--------
Item Level: 86
--------
{ Implicit Modifier â€” Attribute }
+31(25-35) to Strength
--------
{ Unique Modifier â€” Attribute }
+31(30-50) to Dexterity
{ Unique Modifier â€” Resistance }
+20(15-25)% to Fire Resistance
{ Unique Modifier â€” Resistance }
+19(15-25)% to Cold Resistance
{ Unique Modifier }
Magic Utility Flasks cannot be Used
{ Unique Modifier }
Leftmost 4(2-4) Magic Utility Flasks constantly apply their Flask Effects to you
{ Unique Modifier }
Magic Utility Flask Effects cannot be removed`;

const unidentifiedWatcherEyeRaw = `Item Class: Jewels
Rarity: Unique
Prismatic Jewel
--------
Item Level: 86
--------
Unidentified`;

const unidentifiedHeavyBeltRaw = `Item Class: Belts
Rarity: Unique
Heavy Belt
--------
Item Level: 86
--------
Unidentified`;

const magicBodyArmourRaw = `Item Class: Body Armours
Rarity: Magic
Subterranean Vaal Regalia of the Underground
--------
Energy Shield: 175
--------
Item Level: 86
--------
+80 to maximum Energy Shield
+31% to Chaos Resistance`;

const advancedRareBodyArmourRaw = `Item Class: Body Armours
Rarity: Rare
Havoc Shelter
Vaal Regalia
--------
Item Level: 86
--------
{ Implicit Modifier — Defence }
+20(18-20)% increased Energy Shield
--------
{ Prefix Modifier "Resplendent" (Tier: 1) — Defences, Energy Shield }
+129(121-132) to maximum Energy Shield
{ Suffix Modifier "of the Underground" (Tier: 1) — Resistance, Chaos }
+35(31-35)% to Chaos Resistance
{ Master Crafted Prefix Modifier "Chosen" (Rank: 3) — Life }
+70(56-70) to maximum Life`;

const rareWeaponRaw = `Item Class: Bows
Rarity: Rare
Rift Song
Spine Bow
--------
Quality: +20% (augmented)
Physical Damage: 100-200 (augmented)
Elemental Damage: 10-20 (augmented), 30-50 (augmented), 5-15 (augmented)
Critical Strike Chance: 6.50%
Attacks per Second: 1.50
--------
Requirements:
Level: 64
Dex: 212
--------
Item Level: 86
--------
Adds 10 to 20 Fire Damage
100% increased Physical Damage
20% increased Attack Speed`;

const clusterJewelPolicyRaw = `Item Class: Jewels
Rarity: Rare
Rapture Prism
Large Cluster Jewel
--------
Item Level: 83
--------
Adds 8 Passive Skills (enchant)
Added Small Passive Skills grant: 12% increased Lightning Damage (enchant)
--------
2 Added Passive Skills are Jewel Sockets
1 Added Passive Skill is Doryani's Lesson
1 Added Passive Skill is Storm Drinker
Added Small Passive Skills also grant: +4 to All Attributes`;

const magicCobaltJewelRaw = `Item Class: Jewels
Rarity: Magic
Healthy Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Healthy" (Tier: 1) — Life }
7(6-7)% increased maximum Life`;

// Constructed directly from pinned stats.ndjson matcher rows. These fixtures
// exercise APT's rendered-label pipeline rather than adding item-family policy.
const advancedMatcherLabelRaw = `Item Class: Jewels
Rarity: Magic
Scholar's Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Scholar's" (Tier: 1) — Gem }
+1(1-1) to Level of all Fireball(Fireball-Mana-Infused Staff) Gems`;

const multiPlaceholderLabelRaw = `Item Class: Jewels
Rarity: Magic
Serrated Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Serrated" (Tier: 1) — Physical, Damage }
Adds 1(1-1) to 2(2-2) Physical Damage`;

const multilineMatcherLabelRaw = `Item Class: Jewels
Rarity: Magic
Stormcharged Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Stormcharged" (Tier: 1) — Lightning }
20(15-25) Lightning Damage taken per second per Power Charge if
your Skills have dealt a Critical Strike Recently`;

const singularPluralMatcherLabelRaw = `Item Class: Jewels
Rarity: Magic
Shimmering Large Cluster Jewel
--------
Item Level: 83
--------
2 Added Passive Skills are Jewel Sockets (enchant)
--------
{ Prefix Modifier "Shimmering" (Tier: 1) — Jewel }
1 Added Passive Skill is a Jewel Socket`;

const decimalRoundingLabelRaw = `Item Class: Jewels
Rarity: Magic
Siphoning Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Siphoning" (Tier: 1) — Life }
2.299% of Attack Damage Leeched as Life
{ Prefix Modifier "Sanguine" (Tier: 1) — Life }
2.399% of Attack Damage Leeched as Life against Bleeding Enemies
{ Suffix Modifier "of Rime" (Tier: 1) — Life }
9.99% of Attack Damage Leeched as Life against Chilled Enemies
{ Suffix Modifier "of Provocation" (Tier: 1) — Life }
10.99% of Attack Damage Leeched as Life against Maimed Enemies`;

const zeroValueMatcherLabelRaw = `Item Class: Jewels
Rarity: Magic
Haunted Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Haunted" (Tier: 1) — Map }
Wild Rogue Exiles in your Maps have Soul Eater`;

const aggregateMatcherLabelRaw = `Item Class: Jewels
Rarity: Magic
Surgeon's Cobalt Jewel
--------
Item Level: 86
--------
{ Prefix Modifier "Surgeon's" (Tier: 1) — Flask }
40(40-40)% chance to gain a Flask Charge when you deal a Critical Strike
{ Suffix Modifier "of Surgery" (Tier: 1) — Flask }
60(60-60)% chance to gain a Flask Charge when you deal a Critical Strike`;

const mirroredTabletMaxLabelRaw = `Item Class: Misc Map Items
Rarity: Normal
Mirrored Tablet
--------
Area Level: 83
--------
Reflection of Abyss (Difficulty 5)
Reflection of Abyss (Difficulty 8)
Reflection of Ambush (Difficulty 6)
Reflection of Angling (Difficulty 7)
Reflection of Azurite (Difficulty 9)
Reflection of Bestiary (Difficulty 10)
Reflection of Breach (Difficulty 11)
Reflection of Brutality (Difficulty 12)`;

const influenceStateRaw = `Item Class: Rings
Rarity: Rare
Rune Circle
Amethyst Ring
--------
Item Level: 85
--------
Shaper Item
Elder Item`;

const synthesisedStateRaw = `Item Class: Rings
Rarity: Rare
Rune Circle
Synthesised Amethyst Ring
--------
Item Level: 85
--------
Synthesised Item`;

const fracturedStateRaw = `Item Class: Rings
Rarity: Rare
Rune Circle
Amethyst Ring
--------
Item Level: 85
--------
{ Fractured Suffix Modifier "of the Essence" (Tier: 1) — Attribute }
+58(56-60) to Strength`;

function singletonRingStateRaw(state) {
  return `Item Class: Rings
Rarity: Rare
Rune Circle
Amethyst Ring
--------
Item Level: 85
--------
${state}`;
}

const corruptedUniqueRaw = `Item Class: Boots
Rarity: Unique
Ralakesh's Impatience
Riveted Boots
--------
Item Level: 85
--------
{ Corruption Implicit Modifier â€” Gem }
+1 to Level of Socketed Gems
--------
{ Unique Modifier â€” Resistance }
+22(15-25)% to Cold Resistance
{ Unique Modifier }
Count as having maximum number of Power Charges
--------
Corrupted`;

const mapCompletionRewardRaw = `Item Class: Maps
Rarity: Rare
Dire Core
Map (Tier 16)
--------
Map Tier: 16
Reward: Foil The Squire
Item Quantity: +112% (augmented)
Item Rarity: +58% (augmented)
Monster Pack Size: +38% (augmented)
--------
Item Level: 83
--------
Area is inhabited by Goatmen
Monsters deal 104% extra Physical Damage as Fire`;

const uniqueMapRaw = `Item Class: Maps
Rarity: Unique
Whakawairua Tuahu
Map (Tier 16)
--------
Item Level: 83`;

function enchantedFlaskRaw(enchantment) {
  return `Item Class: Utility Flasks
Rarity: Normal
Amethyst Flask
--------
Lasts 6.50 Seconds
Consumes 30 of 60 Charges on use
Currently has 60 Charges
+35% to Chaos Resistance
Quality: +20% (augmented)
--------
Item Level: 83
--------
${enchantment.split("\n").map((line) => `${line} (enchant)`).join("\n")}`;
}

function anointedAccessoryRaw({ baseType = "Amethyst Ring", talisman = false, enchantment }) {
  return `Item Class: ${talisman ? "Amulets" : "Rings"}
Rarity: Rare
Rune Circle
${baseType}
--------
${talisman ? "Talisman Tier: 1\n--------\n" : ""}Item Level: 83
--------
${enchantment} (enchant)`;
}

const foilUnidentifiedUniqueRaw = `Item Class: Boots
Rarity: Unique
Replica Alberon's Warpath
Soldier Boots
--------
Item Level: 80
--------
Foil Unique`;

const foulbornWatcherEyeRaw = `Item Class: Jewels
Rarity: Unique
Foulborn Watcher's Eye
Prismatic Jewel
--------
Limited to: 1
Radius: Medium
--------
Item Level: 86
--------
+10 to all Attributes (implicit)
--------
6% increased maximum Energy Shield
6% increased maximum Life
6% increased maximum Mana
--------
Foulborn Item`;

const vestigialSkyforthRaw = `Item Class: Boots
Rarity: Unique
Skyforth
Vestigial Sorcerer Boots
--------
Item Level: 84
--------
{ Vestigial Implicit Modifier â€” Defence }
+20(18-20)% increased Energy Shield`;

const foulbornMagebloodRaw = `Item Class: Belts
Rarity: Unique
Foulborn Mageblood
Heavy Belt
--------
Item Level: 86
--------
{ Foulborn Unique Modifier — Life }
+80(70-80) to maximum Life`;

const golemSpellKineticWandRaw = `Item Class: Wands
Rarity: Rare
Golem Spell
Kinetic Wand
--------
Wand
Quality: +28% (augmented)
Physical Damage: 283-513 (augmented)
Critical Strike Chance: 11.05% (augmented)
Attacks per Second: 1.90 (augmented)
Intangibility: 18%
--------
Requirements:
Level: 66
Str: 130
Int: 188
--------
Sockets: W-W-W${" "}
--------
Item Level: 99
--------
8% increased Explicit Physical Modifier magnitudes (enchant)
--------
{ Implicit Modifier }
Cannot roll Caster Modifiers
--------
{ Prefix Modifier "Flaring" (Tier: 1) — Damage, Physical, Attack  — 8% Increased }
Adds 29(22-29) to 51(45-52) Physical Damage
{ Prefix Modifier "Merciless" (Tier: 1) — Damage, Physical, Attack  — 8% Increased }
171(170-179)% increased Physical Damage
{ Prefix Modifier "Dictator's" (Tier: 1) — Damage, Physical, Attack  — 8% Increased }
78(75-79)% increased Physical Damage
+196(175-200) to Accuracy Rating
{ Suffix Modifier "of the Order" (Tier: 1) — Attack, Critical, Attribute }
+27(25-28) to Strength and Intelligence
30(28-32)% increased Critical Strike Chance
{ Suffix Modifier "of Acclaim" (Tier: 1) — Attack, Speed }
19(17-19)% increased Attack Speed
{ Master Crafted Suffix Modifier "of Craft" (Rank: 3) — Damage, Critical }
+28(25-28)% to Global Critical Strike Multiplier`;

const malachaisLoopVestigialRaw = `Item Class: Shields
Rarity: Unique
Malachai's Loop
Vestigial Harmonic Spirit Shield
--------
Quality: +20% (augmented)
Chance to Block: 23%
Energy Shield: 240 (augmented)
--------
Requirements:
Level: 70
Str: 98
Int: 159
--------
Sockets: W-B-W
--------
Item Level: 70
--------
{ Vestigial Implicit Modifier }
1% increased Area of Effect per Enemy killed recently, up to 25%
(Recently refers to the past 4 seconds)
--------
{ Unique Modifier — Defences, Energy Shield }
223(210-250)% increased Energy Shield
{ Unique Modifier }
+2 to Maximum Power Charges
{ Unique Modifier — Damage, Caster }
15(12-16)% increased Spell Damage per Power Charge
{ Unique Modifier }
20% chance to gain a Power Charge on Hit
{ Unique Modifier }
Lose all Power Charges on reaching Maximum Power Charges
{ Unique Modifier — Elemental, Lightning, Ailment }
Shocks you when you reach Maximum Power Charges
(Shock increases Damage taken by 15%, for 2 seconds)
--------
Thaumaturgy has no limit.
It is our fragile reality that imposes boundaries.`;

const familyFixtures = [
  categoryFixture("category-abyss-jewel", "Abyss Jewel", "Abyss Jewels", "Ghastly Eye Jewel"),
  categoryFixture("category-amulet", "Amulet", "Amulets", "Agate Amulet"),
  categoryFixture("category-belt", "Belt", "Belts", "Heavy Belt"),
  categoryFixture("category-body-armour", "Body Armour", "Body Armours", "Vaal Regalia"),
  categoryFixture("category-boots", "Boots", "Boots", "Sorcerer Boots"),
  categoryFixture("category-bow", "Bow", "Bows", "Spine Bow"),
  categoryFixture("category-chart", "Chart", "Chart", "Coral Forest Chart", chartRaw),
  categoryFixture("category-claw", "Claw", "Claws", "Gemini Claw"),
  categoryFixture("category-cluster-jewel", "Cluster Jewel", "Jewels", "Large Cluster Jewel"),
  categoryFixture("category-dagger", "Dagger", "Daggers", "Ambusher"),
  categoryFixture("category-expedition-logbook", "Expedition Logbook", "Expedition Logbooks", "Expedition Logbook", logbookRaw),
  categoryFixture("category-fishing-rod", "Fishing Rod", "Fishing Rods", "Fishing Rod"),
  categoryFixture("category-flask", "Flask", "Utility Flasks", "Amethyst Flask", flaskRaw),
  categoryFixture("category-gloves", "Gloves", "Gloves", "Titan Gauntlets"),
  categoryFixture(
    "category-heist-blueprint",
    "Heist Blueprint",
    "Blueprints",
    "Blueprint: Bunker",
    normalFixture("Blueprints", "Blueprint: Bunker", [[
      "Area Level: 83",
      "Heist Target: Enchanted Armaments",
      "Wings Revealed: 4",
    ]]),
  ),
  categoryFixture("category-heist-brooch", "Heist Brooch", "Heist Brooches", "Enamel Brooch"),
  categoryFixture("category-heist-cloak", "Heist Cloak", "Heist Cloaks", "Hooded Cloak"),
  categoryFixture(
    "category-heist-contract",
    "Heist Contract",
    "Contracts",
    "Contract: Bunker",
    normalFixture("Contracts", "Contract: Bunker", [[
      "Area Level: 83",
      "Requires Lockpicking (Level 5)",
      "Contract Target: Priceless",
    ]]),
  ),
  categoryFixture("category-heist-gear", "Heist Gear", "Heist Gear", "Aggregator Charm"),
  categoryFixture("category-heist-tool", "Heist Tool", "Heist Tools", "Fine Lockpick"),
  categoryFixture("category-helmet", "Helmet", "Helmets", "Hubris Circlet"),
  categoryFixture("category-idol", "Idol", "Idols", "Minor Idol"),
  categoryFixture("category-invitation", "Invitation", "Misc Map Items", "Incandescent Invitation"),
  categoryFixture("category-jewel", "Jewel", "Jewels", "Cobalt Jewel"),
  categoryFixture(
    "category-map",
    "Map",
    "Maps",
    "Map",
    `Item Class: Maps
Rarity: Normal
Map (Tier 16)
--------
Item Level: 83`,
  ),
  categoryFixture("category-one-handed-axe", "One-Handed Axe", "One Hand Axes", "Siege Axe"),
  categoryFixture("category-one-handed-mace", "One-Handed Mace", "One Hand Maces", "Behemoth Mace"),
  categoryFixture("category-one-handed-sword", "One-Handed Sword", "One Hand Swords", "Corsair Sword"),
  categoryFixture("category-quiver", "Quiver", "Quivers", "Broadhead Arrow Quiver"),
  categoryFixture("category-ring", "Ring", "Rings", "Amethyst Ring"),
  categoryFixture("category-rune-dagger", "Rune Dagger", "Rune Daggers", "Demon Dagger"),
  categoryFixture("category-sanctum-relic", "Sanctum Relic", "Sanctum Relics", "Coffer Relic"),
  categoryFixture("category-sceptre", "Sceptre", "Sceptres", "Void Sceptre"),
  categoryFixture("category-shield", "Shield", "Shields", "Titanium Spirit Shield"),
  categoryFixture("category-staff", "Staff", "Staves", "Imperial Staff"),
  categoryFixture("category-tincture", "Tincture", "Tinctures", "Ashbark Tincture", tinctureRaw),
  categoryFixture("category-trinket", "Trinket", "Trinkets", "Thief's Trinket"),
  categoryFixture("category-two-handed-axe", "Two-Handed Axe", "Two Hand Axes", "Vaal Axe"),
  categoryFixture("category-two-handed-mace", "Two-Handed Mace", "Two Hand Maces", "Coronal Maul"),
  categoryFixture("category-two-handed-sword", "Two-Handed Sword", "Two Hand Swords", "Exquisite Blade"),
  categoryFixture(
    "category-unique-fragment",
    "Unique Fragment",
    "Unique Fragments",
    "Archon Kite Shield Piece",
    `Item Class: Unique Fragments
Rarity: Unique
First Piece of Focus
Archon Kite Shield Piece
--------
The first piece of a whole long forgotten.`,
  ),
  categoryFixture("category-wand", "Wand", "Wands", "Imbued Wand"),
  categoryFixture("category-warstaff", "Warstaff", "Warstaves", "Judgement Staff"),
  categoryFixture(
    "category-captured-beast",
    "Captured Beast",
    "Captured Beasts",
    "Farric Lynx Alpha",
    `Item Class: Captured Beasts
Rarity: Rare
Farric Lynx Alpha
--------
Genus: Felines
Group: Felines
Family: The Wilds
--------
Item Level: 83
--------
Right-click to add this to your bestiary.`,
  ),
  categoryFixture(
    "category-currency",
    "Currency",
    "Stackable Currency",
    "Divine Orb",
    `Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 3/20
--------
Randomises the values of the random modifiers on an item`,
  ),
  categoryFixture(
    "category-divination-card",
    "Divination Card",
    "Divination Cards",
    "The Doctor",
    `Item Class: Divination Cards
Rarity: Divination Card
The Doctor
--------
Stack Size: 1/8
--------
Headhunter`,
  ),
  categoryFixture(
    "category-gem",
    "Gem",
    "Skill Gems",
    "Fireball",
    `Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Projectile, Spell, AoE, Fire
Level: 20 (Max)
Cost: 6 Mana
Quality: +20% (augmented)
--------
Deals 100 to 150 Fire Damage`,
  ),
];

const branchFixtures = [
  branchFixture("branch-unique-mageblood-advanced", "Belt", magebloodAdvancedRaw),
  branchFixture("branch-unidentified-watcher-eye", "Jewel", unidentifiedWatcherEyeRaw),
  branchFixture("branch-unidentified-unique-heavy-belt", "Belt", unidentifiedHeavyBeltRaw),
  branchFixture("branch-magic-body-armour", "Body Armour", magicBodyArmourRaw),
  branchFixture("branch-advanced-rare-body-armour", "Body Armour", advancedRareBodyArmourRaw),
  branchFixture("branch-rare-weapon", "Bow", rareWeaponRaw),
  branchFixture("branch-golem-spell-kinetic-wand", "Wand", golemSpellKineticWandRaw, ORIGIN_SANITIZED_LIVE),
  branchFixture("branch-cluster-jewel-policy", "Cluster Jewel", clusterJewelPolicyRaw),
  branchFixture("branch-magic-cobalt-jewel", "Jewel", magicCobaltJewelRaw),
  branchFixture("branch-influence-state", "Ring", influenceStateRaw),
  branchFixture("branch-synthesised-state", "Ring", synthesisedStateRaw),
  branchFixture("branch-fractured-state", "Ring", fracturedStateRaw),
  branchFixture("branch-corrupted-state", "Ring", singletonRingStateRaw("Corrupted")),
  branchFixture("branch-mirrored-state", "Ring", singletonRingStateRaw("Mirrored")),
  branchFixture("branch-split-state", "Ring", singletonRingStateRaw("Split")),
  branchFixture("branch-corrupted-unique", "Boots", corruptedUniqueRaw),
  branchFixture("branch-map-completion-reward", "Map", mapCompletionRewardRaw),
  branchFixture("branch-unique-map", "Map", uniqueMapRaw),
  branchFixture(
    "branch-flask-instilling-enchantment",
    "Flask",
    enchantedFlaskRaw("Used when Charges reach full"),
  ),
  branchFixture(
    "branch-flask-enkindling-enchantment",
    "Flask",
    enchantedFlaskRaw("70% increased effect\nGains no Charges during Effect"),
  ),
  branchFixture(
    "branch-anoint-low-oil-ring",
    "Ring",
    anointedAccessoryRaw({
      enchantment: "Your Chilling Towers have 25% increased effect of Chill",
    }),
  ),
  branchFixture(
    "branch-anoint-high-oil-ring",
    "Ring",
    anointedAccessoryRaw({
      enchantment: "All Towers in range of your Empowering Towers have 50% chance to deal Double Damage",
    }),
  ),
  branchFixture(
    "branch-anoint-low-oil-talisman",
    "Amulet",
    anointedAccessoryRaw({
      baseType: "Black Maw Talisman",
      talisman: true,
      enchantment: "Your Chilling Towers have 25% increased effect of Chill",
    }),
  ),
  branchFixture("branch-foil-unique", "Boots", foilUnidentifiedUniqueRaw),
  branchFixture("branch-foulborn-watcher-eye", "Jewel", foulbornWatcherEyeRaw),
  branchFixture("branch-foulborn-mageblood", "Belt", foulbornMagebloodRaw),
  branchFixture("branch-vestigial-skyforth", "Boots", vestigialSkyforthRaw),
  branchFixture("branch-vestigial-malachais-loop", "Shield", malachaisLoopVestigialRaw, ORIGIN_SANITIZED_LIVE),
  branchFixture(
    "branch-vaal-gem-singleton",
    "Gem",
    `Item Class: Skill Gems
Rarity: Gem
Vaal Fireball
--------
Fireball
--------
Projectile, Spell, AoE, Vaal, Fire
Level: 20 (Max)
Cost: 6 Mana
Quality: +20% (augmented)
--------
Deals 100 to 150 Fire Damage
--------
Corrupted`,
  ),
  branchFixture(
    "branch-split-cannot-use-nameplate",
    "Body Armour",
    `Item Class: Body Armours
Rarity: Rare
You cannot use this item. Its stats will be ignored
--------
Doom Shell
Vaal Regalia
--------
Energy Shield: 175
--------
Requirements:
Level: 68 (unmet)
Int: 194 (unmet)
--------
Item Level: 83`,
  ),
  branchFixture(
    "branch-mirrored-tablet-eight-lines",
    undefined,
    `Item Class: Misc Map Items
Rarity: Normal
Mirrored Tablet
--------
Area Level: 83
--------
Reflection of Abyss (Difficulty 5)
Reflection of Ambush (Difficulty 6)
Reflection of Angling (Difficulty 7)
Reflection of Azurite (Difficulty 8)
Reflection of Bestiary (Difficulty 9)
Reflection of Breach (Difficulty 10)
Reflection of Brutality (Difficulty 11)
Reflection of Fractured Dimensions (Difficulty 12)`,
  ),
  branchFixture("branch-flask-properties", "Flask", flaskRaw),
  branchFixture("branch-tincture-properties", "Tincture", tinctureBasePropertiesRaw),
  ...[3, 4, 5, 6].map((links) => branchFixture(
    `branch-${links}-link-sockets`,
    "Body Armour",
    `Item Class: Body Armours
Rarity: Normal
Simple Robe
--------
Energy Shield: 12
--------
Sockets: ${Array.from({ length: links }, () => "B").join("-")}
--------
Item Level: 12`,
  )),
  branchFixture("branch-chart-properties", "Chart", chartRaw, ORIGIN_SANITIZED_LIVE),
  branchFixture(
    "branch-imbued-gem",
    "Gem",
    `Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Projectile, Spell, AoE, Fire
Level: 20 (Max)
Cost: 6 Mana
Quality: +20% (augmented)
--------
Supported by Level 1 Added Fire Damage
--------
Deals 100 to 150 Fire Damage`,
  ),
  branchFixture(
    "branch-veiled-word-is-not-state",
    "Map",
    `Item Class: Maps
Rarity: Rare
Hidden Route
Map (Tier 16)
--------
Item Quantity: +80% (augmented)
Item Rarity: +40% (augmented)
Monster Pack Size: +25% (augmented)
--------
Item Level: 83
--------
{ Prefix Modifier "Cartographer's" (Tier: 1) — Map }
Immortal Syndicate Leaders in your Maps drop an additional Veiled Item`,
  ),
  branchFixture(
    "branch-synthesised-word-is-not-state",
    "Map",
    `Item Class: Maps
Rarity: Rare
Hidden Route
Map (Tier 16)
--------
Item Quantity: +80% (augmented)
Item Rarity: +40% (augmented)
Monster Pack Size: +25% (augmented)
--------
Item Level: 83
--------
{ Prefix Modifier "Cartographer's" (Tier: 1) — Map }
Synthesised Monsters in Synthesis Maps have 20(15-25)% increased Pack Size`,
  ),
  branchFixture(
    "branch-fractured-word-is-not-state",
    undefined,
    `Item Class: Misc Map Items
Rarity: Normal
Mirrored Tablet
--------
Area Level: 83
--------
Reflection of Fractured Dimensions (Difficulty 12)
Reflection of Abyss (Difficulty 5)
Reflection of Ambush (Difficulty 6)
Reflection of Angling (Difficulty 7)
Reflection of Azurite (Difficulty 8)
Reflection of Bestiary (Difficulty 9)
Reflection of Breach (Difficulty 10)
Reflection of Brutality (Difficulty 11)`,
  ),
  branchFixture(
    "branch-resolver-transforms",
    "Ring",
    `Item Class: Rings
Rarity: Rare
Resolver Loop
Amethyst Ring
--------
Requirements:
Level: 60
--------
Item Level: 83
--------
{ Prefix Modifier "Vulnerability" (Tier: 1) — Curse }
Curse Enemies with Vulnerability on Hit
{ Prefix Modifier "Surgeon's" (Tier: 1) — Flask }
Gain a Flask Charge when you deal a Critical Strike
{ Suffix Modifier "of Shattering" (Tier: 1) — Cold }
Enemies Frozen by you take 20(20-20)% increased Damage`,
  ),
  branchFixture(
    "branch-resolver-select-weapon",
    "Wand",
    `Item Class: Wands
Rarity: Rare
Resolver Spell
Imbued Wand
--------
Physical Damage: 20-40
Critical Strike Chance: 7.00%
Attacks per Second: 1.50
--------
Requirements:
Level: 60
--------
Item Level: 83
--------
{ Suffix Modifier "of Celebration" (Tier: 1) — Attack, Speed }
20(18-20)% increased Attack Speed`,
  ),
  branchFixture("branch-label-advanced-canonical", "Jewel", advancedMatcherLabelRaw),
  branchFixture("branch-label-multi-placeholder", "Jewel", multiPlaceholderLabelRaw),
  branchFixture("branch-label-multiline", "Jewel", multilineMatcherLabelRaw),
  branchFixture("branch-label-singular-plural", "Cluster Jewel", singularPluralMatcherLabelRaw),
  branchFixture("branch-label-decimal-rounding", "Jewel", decimalRoundingLabelRaw),
  branchFixture("branch-label-zero-value", "Jewel", zeroValueMatcherLabelRaw),
  branchFixture("branch-label-aggregate-sum", "Jewel", aggregateMatcherLabelRaw),
  branchFixture("branch-label-mirrored-tablet-max", undefined, mirroredTabletMaxLabelRaw),
];

export const APT_FAMILY_PARITY_FIXTURES = [...familyFixtures, ...branchFixtures];
