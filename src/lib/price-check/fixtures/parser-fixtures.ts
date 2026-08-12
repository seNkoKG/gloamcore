export const currencyFixture = `Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 3/20
--------
Randomises the values of the random modifiers on an item
--------
Right click this item then left click a magic, rare or unique item to apply it.`;

export const uniqueFixture = `Item Class: Belts
Rarity: Unique
Mageblood
Heavy Belt
--------
Requirements:
Level: 44
--------
Item Level: 86
--------
+35 to Strength (implicit)
--------
+39 to Dexterity
+41 to Intelligence
+79 to maximum Life
+38% to Fire Resistance
+37% to Cold Resistance
Magic Utility Flasks cannot be Used
Leftmost 4 Magic Utility Flasks constantly apply their Flask Effects to you
Magic Utility Flask Effects cannot be removed
--------
"They have but one drink left."
— Medved, the Last One`;

/** Current PoE 3.29 Advanced Description, with ranges pinned by PoB 2.66.1. */
export const magebloodAdvancedFixture = `Item Class: Belts
Rarity: Unique
Mageblood
Heavy Belt
--------
Requirements:
Level: 44
--------
Item Level: 86
--------
{ Implicit Modifier — Attribute }
+31(25-35) to Strength
--------
{ Unique Modifier — Attribute }
+31(30-50) to Dexterity
{ Unique Modifier — Resistance }
+20(15-25)% to Fire Resistance
{ Unique Modifier — Resistance }
+19(15-25)% to Cold Resistance
{ Unique Modifier }
Magic Utility Flasks cannot be Used
{ Unique Modifier }
Leftmost 4(2-4) Magic Utility Flasks constantly apply their Flask Effects to you
{ Unique Modifier }
Magic Utility Flask Effects cannot be removed`;

export const unquotedFlavourUniqueFixture = `Item Class: Boots
Rarity: Unique
Ralakesh's Impatience
Riveted Boots
--------
Item Level: 85
--------
{ Corruption Implicit Modifier — Gem }
+1 to Level of Socketed Gems
--------
{ Unique Modifier — Resistance }
+22(15-25)% to Cold Resistance
{ Unique Modifier }
Count as having maximum number of Power Charges
--------
The Master of a Million Faces lived by one
simple ethos: why make the effort, when
you can simply mimic what others have?
--------
Corrupted`;

/** Pinned malformed-header oracle: mojibake is data, not an em dash. */
export const malformedCorruptedUniqueFixture = `Item Class: Boots
Rarity: Unique
Ralakesh's Impatience
Riveted Boots
--------
Item Level: 85
--------
{ Corruption Implicit Modifier \u00e2\u20ac\u201d Gem }
+1 to Level of Socketed Gems
--------
{ Unique Modifier \u00e2\u20ac\u201d Resistance }
+22(15-25)% to Cold Resistance
{ Unique Modifier }
Count as having maximum number of Power Charges
--------
Corrupted`;

export const watcherEyeFixture = `Item Class: Jewels
Rarity: Unique
Watcher's Eye
Prismatic Jewel
--------
Limited to: 1
Radius: Medium
--------
Item Level: 86
--------
6% increased maximum Energy Shield
6% increased maximum Life
6% increased maximum Mana
--------
+25% to Critical Strike Multiplier while affected by Precision
Gain 15% of Physical Damage as Extra Fire Damage while affected by Anger`;

/** Current Advanced Description form used by modifier-policy tests. */
export const watcherEyeAdvancedFixture = `Item Class: Jewels
Rarity: Unique
Watcher's Eye
Prismatic Jewel
--------
Limited to: 1
Radius: Medium
--------
Item Level: 86
--------
{ Implicit Modifier — Attribute }
+10 to all Attributes
--------
{ Unique Modifier — Defences, Energy Shield }
6% increased maximum Energy Shield
{ Unique Modifier — Life }
6% increased maximum Life
{ Unique Modifier — Mana }
6% increased maximum Mana
--------
{ Unique Modifier — Critical }
+25% to Critical Strike Multiplier while affected by Precision
{ Unique Modifier — Damage, Physical, Fire }
Gain 15% of Physical Damage as Extra Fire Damage while affected by Anger`;

export const impossibleEscapeFixture = `Item Class: Jewels
Rarity: Unique
Impossible Escape
Viridian Jewel
--------
Limited to: 1
Radius: Small
--------
Item Level: 85
--------
{ Unique Modifier }
Passive Skills in Radius of Chaos Inoculation can be Allocated
without being connected to your tree
Passage
--------
"There is no freedom without consequence."
--------
This item can be socketed into an allocated Jewel Socket on the Passive Skill Tree.`;

export const splitPersonalityFixture = `Item Class: Jewels
Rarity: Unique
Split Personality
Crimson Jewel
--------
Limited to: 2
--------
Item Level: 84
--------
{ Unique Modifier }
This Jewel's Socket has 25% increased effect per Allocated Passive Skill between
it and your Class' starting location
{ Unique Modifier — Attribute }
+5 to Strength
{ Unique Modifier — Attribute }
+5 to Intelligence`;

export const megalomaniacFixture = `Item Class: Jewels
Rarity: Unique
Megalomaniac
Medium Cluster Jewel
--------
Limited to: 1
--------
Item Level: 84
--------
{ Unique Modifier }
Adds 4 Passive Skills
{ Unique Modifier }
Added Small Passive Skills grant Nothing
{ Unique Modifier }
1 Added Passive Skill is Blanketed Snow
{ Unique Modifier }
1 Added Passive Skill is Prismatic Heart
{ Unique Modifier }
1 Added Passive Skill is Widespread Destruction`;

export const threadOfHopeFixture = `Item Class: Jewels
Rarity: Unique
Thread of Hope
Crimson Jewel
--------
Limited to: 1
Radius: Variable
--------
Item Level: 84
--------
{ Unique Modifier — Resistance }
-11% to all Elemental Resistances
{ Unique Modifier }
Only affects Passives in Massive Ring
{ Unique Modifier }
Passives in Radius can be Allocated without being connected to your tree`;

export const forbiddenFlameFixture = `Item Class: Jewels
Rarity: Unique
Forbidden Flame
Crimson Jewel
--------
Limited to: 1
--------
Item Level: 85
--------
{ Unique Modifier }
Allocates Ancestral Fury if you have the matching modifier on Forbidden Flesh
Corrupted`;

export const foulbornWatcherEyeFixture = `Item Class: Jewels
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

/** Current Advanced Foulborn copy; the plain oracle above intentionally has no rows. */
export const foulbornWatcherEyeAdvancedFixture = `Item Class: Jewels
Rarity: Unique
Foulborn Watcher's Eye
Prismatic Jewel
--------
Limited to: 1
Radius: Medium
--------
Item Level: 86
--------
{ Implicit Modifier — Attribute }
+10 to all Attributes
--------
{ Foulborn Unique Modifier — Defences, Energy Shield }
6% increased maximum Energy Shield
{ Foulborn Unique Modifier — Life }
6% increased maximum Life
{ Foulborn Unique Modifier — Mana }
6% increased maximum Mana
--------
Foulborn Item`;

export const unidentifiedWatcherEyeFixture = `Item Class: Jewels
Rarity: Unique
Prismatic Jewel
--------
Item Level: 86
--------
Unidentified`;

export const timelessJewelFixture = `Item Class: Jewels
Rarity: Unique
Glorious Vanity
Timeless Jewel
--------
Limited to: 1 Historic
Radius: Large
--------
Item Level: 83
--------
Bathed in the blood of 5123 sacrificed in the name of Doryani
Passives in radius are Conquered by the Vaal
--------
Historic`;

/** Exact advanced-description shape from the reported in-game Lethal Pride. */
export const lethalPrideKaomAdvancedFixture = `Item Class: Jewels
Rarity: Unique
Lethal Pride
Timeless Jewel
--------
Limited to: 1 Historic
Radius: Large
--------
Item Level: 84
--------
{ Unique Modifier — Jewel }
Commanded leadership over 12476(10000-18000) warriors under Kaom(Akoya-Rakiata)
Passives in radius are Conquered by the Karui
--------
Historic
--------
They believed themselves the greatest warriors, but that savagery
turned upon their own.`;

export const magicFixture = `Item Class: Body Armours
Rarity: Magic
Subterranean Vaal Regalia of the Underground
--------
Energy Shield: 175
--------
Item Level: 86
--------
+80 to maximum Energy Shield
+31% to Chaos Resistance`;

export const advancedRareFixture = `Item Class: Body Armours
Rarity: Rare
Havoc Shelter
Vaal Regalia
--------
Quality: +30% (augmented)
Energy Shield: 812 (augmented)
--------
Requirements:
Level: 68
Int: 194
--------
Sockets: B-B-B-B-B-B
--------
Item Level: 86
--------
{ Implicit Modifier — Defence }
+20(18-20)% increased Energy Shield (implicit)
--------
{ Prefix Modifier "Resplendent" (Tier: 1) — Defences, Energy Shield — 20% Increased }
+129(121-132) to maximum Energy Shield
109(101-110)% increased Energy Shield
{ Suffix Modifier "of the Underground" (Tier: 1) — Resistance, Chaos }
+35(31-35)% to Chaos Resistance
{ Master Crafted Prefix Modifier "Chosen" (Tier: 1) — Life }
+70(56-70) to maximum Life (crafted)
--------
Hunter Item
Fractured Item`;

/** Exact pinned root-2 Advanced body-armour parser oracle. */
export const aptAdvancedRareBodyArmourFixture = `Item Class: Body Armours
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

/** Two separate Advanced affixes whose lines also form a valid multiline stat. */
export const advancedCrossAffixBoundaryFixture = `Item Class: Maps
Rarity: Rare
Boundary Test
Map (Tier 16)
--------
Map Tier: 16
--------
Item Level: 83
--------
{ Prefix Modifier "Boundary A" (Tier: 1) — Map }
Monsters' Action Speed cannot be modified to below Base Value
{ Suffix Modifier "Boundary B" (Tier: 1) — Map }
Monsters' Movement Speed cannot be modified to below Base Value`;

/** The same ambiguous stat lines inside one Advanced affix may be combined. */
export const advancedWithinGroupPrefixAmbiguityFixture = `Item Class: Maps
Rarity: Rare
Boundary Test
Map (Tier 16)
--------
Map Tier: 16
--------
Item Level: 83
--------
{ Prefix Modifier "Boundary Pair" (Tier: 1) — Map }
Monsters' Action Speed cannot be modified to below Base Value
Monsters' Movement Speed cannot be modified to below Base Value`;

export const rareDefenceFixture = `Item Class: Shields
Rarity: Rare
Havoc Shelter
Supreme Spiked Shield
--------
Quality: +30% (augmented)
Armour: 1,200 (augmented)
Evasion Rating: 700 (augmented)
Energy Shield: 300 (augmented)
Chance to Block: 25%
--------
Requirements:
Level: 70
Str: 85
Dex: 85
Int: 85
--------
Item Level: 86
--------
100% increased Armour and Evasion
+100 to maximum Energy Shield
+35% to Chaos Resistance`;

export const armourModifierParityFixture = `Item Class: Body Armours
Rarity: Rare
Damnation Pelt
Twilight Regalia
--------
Quality: +20% (augmented)
Energy Shield: 753 (augmented)
[Intangibility|Intangibility]: 8%
--------
Requirements:
Level: 68
Int: 194
--------
Sockets: B-B-B-B-B-B
--------
Item Level: 86
--------
{ Prefix Modifier "Unassailable" (Tier: 1) — Defences, Energy Shield — 100% Increased }
100(81-100)% increased Energy Shield
{ Suffix Modifier "of the Prism" (Tier: 1) — Resistance }
+17% to Fire Resistance
+13% to Cold Resistance
+11% to Lightning Resistance
{ Suffix Modifier "of Mending" (Tier: 2) — Life }
Regenerate 7(6-7) Life per second
{ Prefix Modifier "Chosen" (Tier: 1) — Effect }
10(9-10)% increased Area of Effect
Enemies you Kill have a 35(31-35)% chance to Explode, dealing a quarter of their maximum Life as Chaos Damage
17(16-17)% increased Stun and Block Recovery
Ignore Stuns while using Socketed Attack Skills
Socketed Attacks have -20 to Total Mana Cost`;

export const rareWeaponFixture = `Item Class: Bows
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

/** Exact advanced-description clipboard recovered from the reported wand check. */
export const golemSpellKineticWandFixture = `Item Class: Wands
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
+28(25-28)% to Global Critical Strike Multiplier
`;

/** Sanitized APT fixture proving integer magnitude metadata and truncation. */
export const advancedIntegerMagnitudeFixture = `Item Class: Wands
Rarity: Rare
Sanitised Integer
Kinetic Wand
--------
Item Level: 86
--------
{ Prefix Modifier "Magnitude Integer" (Tier: 1) — Damage, Physical, Attack — 8% Increased }
171(170-179)% increased Physical Damage`;

/** Sanitized APT fixture proving two-decimal magnitude metadata. */
export const advancedDecimalMagnitudeFixture = `Item Class: Wands
Rarity: Rare
Sanitised Decimal
Kinetic Wand
--------
Item Level: 86
--------
{ Suffix Modifier "Magnitude Decimal" (Tier: 1) — Attack, Speed — 8% Increased }
1.25(1.00-1.50)% increased Attack Speed`;

/** Sanitized APT fixture proving that Unscalable Value suppresses magnitude. */
export const advancedUnscalableMagnitudeFixture = `Item Class: Wands
Rarity: Rare
Sanitised Unscalable
Kinetic Wand
--------
Item Level: 86
--------
{ Suffix Modifier "Magnitude Fixed" (Tier: 1) — Attack, Speed — 8% Increased }
1.25(1.00-1.50)% increased Attack Speed — Unscalable Value`;

/** Sanitized APT fixture proving legacy rolls outside advertised bounds. */
export const advancedLegacyOutOfRangeFixture = `Item Class: Wands
Rarity: Rare
Sanitised Legacy
Kinetic Wand
--------
Item Level: 86
--------
{ Suffix Modifier "Legacy Range" (Tier: 1) — Attack, Speed }
25(10-20)% increased Attack Speed`;

/** Exact 3.29 Advanced shape for a legacy Unique roll with one source bound. */
export const kaomsHeartLegacyFixture = `Item Class: Body Armours
Rarity: Unique
Kaom's Heart
Glorious Plate
--------
Quality: +20% (augmented)
Armour: 1012 (augmented)
--------
Requirements:
Level: 68
Str: 191 (unmet)
--------
Item Level: 80
--------
{ Unique Modifier \u2014 Life }
+1170(1000) to maximum Life
{ Unique Modifier }
Has no Sockets
--------
The warrior who
fears will fall.
--------
Corrupted`;

export const lowQualityWeaponFixture = rareWeaponFixture.replace(
  "Quality: +20% (augmented)",
  "Quality: +10% (augmented)",
);

export const gemFixture = `Item Class: Skill Gems
Rarity: Gem
Awakened Added Cold Damage Support
--------
Cold, Support
Level: 5 (Max)
Cost & Reservation Multiplier: 130%
Quality: +20% (augmented)
Experience: 1/1
--------
Requirements:
Level: 72
Int: 114
--------
Supports any skill that hits enemies.
Supported Skills have +1 to Level of all Cold Skill Gems
Supported Skills have 39% of Physical Damage as Extra Cold Damage
--------
Corrupted`;

export const mapFixture = `Item Class: Maps
Rarity: Rare
Dire Core
Crater Map
--------
Map Tier: 16
Item Quantity: +112% (augmented)
Item Rarity: +58% (augmented)
Monster Pack Size: +38% (augmented)
--------
Item Level: 83
--------
Area is inhabited by Goatmen
Monsters deal 104% extra Physical Damage as Fire
Players have 40% less Recovery Rate of Life and Energy Shield
+35% Monster Chaos Resistance
--------
Corrupted`;

/** Sanitized live Allflame Chart text returned by official Trade. */
export const chartFixture = `Item Class: Chart
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

/** Sanitized live unidentified Chart text; Awakened exposes Bulk only. */
export const unidentifiedChartFixture = `Item Class: Chart
Rarity: Magic
Coral Forest Chart
--------
Undersea Groves
Area Level: 12
--------
Item Level: 12
--------
Voyage Modifier will be revealed once Charted
--------
Chart Shape: End
--------
Unidentified
--------
Take this item to Valerie aboard the Sovereign to Chart this area.`;

export const divinationCardFixture = `Item Class: Divination Cards
Rarity: Divination Card
The Doctor
--------
Stack Size: 1/8
--------
Headhunter
--------
"They said I needed my head examined, but I'd rather just take yours."`;

export const clusterJewelFixture = `Item Class: Jewels
Rarity: Rare
Rapture Prism
Large Cluster Jewel
--------
Requirements:
Level: 54
--------
Item Level: 84
--------
Adds 8 Passive Skills (enchant)
Added Small Passive Skills grant: 12% increased Lightning Damage (enchant)
--------
1 Added Passive Skill is Doryani's Lesson
1 Added Passive Skill is Storm Drinker
1 Added Passive Skill is Widespread Destruction
Added Small Passive Skills also grant: +4 to All Attributes
--------
Corrupted`;

export const clusterJewelPolicyFixture = `Item Class: Jewels
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

/** Two eligible plain modifier sections must retain distinct parser groups. */
export const plainModifierGroupBoundaryFixture = `Item Class: Jewels
Rarity: Rare
Rapture Prism
Large Cluster Jewel
--------
Item Level: 83
--------
Adds 8 Passive Skills (enchant)
Added Small Passive Skills grant: 12% increased Lightning Damage (enchant)
--------
2 Added Passive Skills are Jewel Sockets (enchant)`;

export const influencedStatusFixture = `Item Class: Rings
Rarity: Rare
Rune Circle
Amethyst Ring
--------
Requirements:
Level: 64
--------
Item Level: 85
--------
+23% to Chaos Resistance (implicit)
--------
{ Fractured Suffix Modifier "of the Essence" (Tier: 1) — Attribute }
+58(56-60) to Strength (fractured)
{ Veiled Prefix Modifier — Life, Mana }
Veiled Prefix
--------
Shaper Item
Elder Item
Synthesised Item
Split
Mirrored
Scourged`;

export const socketsFixture = `Item Class: Body Armours
Rarity: Normal
Simple Robe
--------
Energy Shield: 12
--------
Sockets: R-G-B W-W A
--------
Item Level: 12
--------
Size: 2x3`;

export const chronicleFixture = `Item Class: Incursion Items
Rarity: Normal
Chronicle of Atzoatl
--------
Area Level: 83
--------
Open Rooms:
Apex of Atzoatl
Locus of Corruption (Tier 3)
Doryani's Institute (Tier 3)
Apex of Ascension (Tier 3)
Wealth of the Vaal (Tier 3)
Atlas of Worlds (Tier 3)
Obstructed Rooms:
Museum of Artefacts (Tier 3)
Hall of War (Tier 3)
--------
Travel to this Temple by using it in a personal Map Device.`;

export const expeditionLogbookFixture = `Item Class: Expedition Logbooks
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
Travel to this area by using it in a personal Map Device.`;

/** Exact Malachai's Loop capture recovered from local price-check history. */
export const malachaisLoopVestigialFixture = `Item Class: Shields
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
It is our fragile reality that imposes boundaries.
`;

/** Pinned malformed-header oracle: Vestigial identity survives, type does not. */
export const malformedVestigialSkyforthFixture = `Item Class: Boots
Rarity: Unique
Skyforth
Vestigial Sorcerer Boots
--------
Item Level: 84
--------
{ Vestigial Implicit Modifier \u00e2\u20ac\u201d Defence }
+20(18-20)% increased Energy Shield`;

/** APT's exact unmet-requirement split: headers/warning precede the nameplate section. */
export const cannotUseSplitFixture = `Item Class: Wands
Rarity: Rare
You cannot use this item. Its stats will be ignored
--------
Doom Needle
Imbued Wand
--------
Quality: +20% (augmented)
Physical Damage: 12-22
Critical Strike Chance: 7.00%
Attacks per Second: 1.50
--------
Item Level: 86
--------
{ Prefix Modifier "Essences" (Tier: 1) }
+120 to maximum Mana`;

/** Vaal gems expose their canonical GEM identity in a later singleton section. */
export const vaalGemSingletonFixture = `Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Vaal Fireball
--------
Fire, Spell, Projectile, AoE, Vaal
Level: 20 (Max)
Cost: 6 Mana
Quality: +20% (augmented)
--------
Requirements:
Level: 70
Int: 155
--------
Launches a ball of fire towards a target which explodes, damaging nearby foes.
--------
Corrupted`;

/** A suffixless built-in support is one Imbued gem stat, not prose. */
export const imbuedGemFixture = `Item Class: Skill Gems
Rarity: Gem
Fireball
--------
Fire, Spell, Projectile, AoE
Level: 20 (Max)
Cost: 6 Mana
Quality: +20% (augmented)
--------
Requirements:
Level: 70
Int: 155
--------
Supported by Level 1 Added Fire Damage`;

/** The whole Flask base-effect block is consumed; only the later affix is searchable. */
export const flaskBasePropertiesFixture = `Item Class: Utility Flasks
Rarity: Magic
Surgeon's Ruby Flask of the Order
Ruby Flask
--------
Quality: +20% (augmented)
Lasts 5.00 Seconds
Consumes 20 of 50 Charges on use
Currently has 0 Charges
+40% to Fire Resistance
--------
Requirements:
Level: 27
--------
Item Level: 86
--------
{ Suffix Modifier "of the Order" (Tier: 1) }
20% increased Charge Recovery`;

/** The whole Tincture quality/base-effect block is consumed before affixes. */
export const tinctureBasePropertiesFixture = `Item Class: Tinctures
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

/** Exact Mirrored Tablet semantic section; APT treats all eight lines as Pseudo. */
export const mirroredTabletFixture = `Item Class: Stackable Currency
Rarity: Currency
Mirrored Tablet
--------
Area Level: 83
--------
Reflection of Kalandra (Difficulty 12)
Reflection of the Sun (Difficulty 11)
Reflection of Delirium (Difficulty 9)
Reflection of the Breachlord (Difficulty 8)
Reflection of the Trove (Difficulty 7)
Reflection of Future Worlds (Difficulty 9)
Reflection of Minor Worlds (Difficulty 7)
Reflection of Phaaryl (Difficulty 8)
--------
Open portals to the Lake of Kalandra by using this item in a personal Map Device.`;

/** Literal status words inside ordinary Explicit stats must not flip item state. */
export const statusWordModifierFixture = `Item Class: Rings
Rarity: Rare
Rune Circle
Amethyst Ring
--------
Item Level: 86
--------
{ Prefix Modifier "Unveiling" (Tier: 1) }
Veiled Modifiers have 10% increased Effect
{ Suffix Modifier "Splinters" (Tier: 1) }
Fractured Items have 5% increased Value
{ Prefix Modifier "Nightmares" (Tier: 1) }
Scourged Monsters take 12% increased Damage`;

function linkedSocketFixture(linkCount: 3 | 4 | 5 | 6) {
  const colors = ["R", "G", "B", "R", "G", "B"].slice(0, linkCount).join("-");
  return `Item Class: Body Armours
Rarity: Normal
Simple Robe
--------
Energy Shield: 12
--------
Sockets: ${colors}
--------
Item Level: 12
--------
Size: 2x3`;
}

export const threeLinkedSocketsFixture = linkedSocketFixture(3);
export const fourLinkedSocketsFixture = linkedSocketFixture(4);
export const fiveLinkedSocketsFixture = linkedSocketFixture(5);
export const sixLinkedSocketsFixture = linkedSocketFixture(6);

/** Raw pinned Heist Blueprint class uses the game-facing `Blueprints` label. */
export const heistBlueprintClassFixture = `Item Class: Blueprints
Rarity: Normal
Blueprint: Bunker
--------
Item Level: 83
--------
Area Level: 83
Heist Target: Enchanted Armaments
Wings Revealed: 4`;

/** Raw pinned Heist Contract class uses the game-facing `Contracts` label. */
export const heistContractClassFixture = `Item Class: Contracts
Rarity: Normal
Contract: Bunker
--------
Item Level: 83
--------
Area Level: 83
Requires Lockpicking (Level 5)
Contract Target: Priceless`;

/** One-line magic Flask nameplate must resolve its pinned base identity. */
export const oneLineMagicFlaskFixture = `Item Class: Utility Flasks
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
{ Prefix Modifier "Chemist's" (Tier: 1) â€” Flask }
20(20-20)% reduced Charges per use
{ Suffix Modifier "of the Deer" (Tier: 1) â€” Flask }
40(36-40)% increased Evasion Rating during Effect`;

/** One-line magic Tincture nameplate must resolve its pinned base identity. */
export const oneLineMagicTinctureFixture = `Item Class: Tinctures
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
{ Prefix Modifier "Perfect" (Tier: 1) â€” Tincture }
20(18-20)% increased Cooldown Recovery Rate
{ Suffix Modifier "of the Oak" (Tier: 1) â€” Tincture }
15(13-15)% increased Effect`;

/** Unique Fragment prose is lore, never a searchable explicit modifier. */
export const uniqueFragmentFlavourFixture = `Item Class: Unique Fragments
Rarity: Unique
First Piece of Focus
Archon Kite Shield Piece
--------
The first piece of a whole long forgotten.`;

/** Captured Beast uses a special category even though its rarity is Rare. */
export const capturedBeastCategoryFixture = `Item Class: Captured Beasts
Rarity: Rare
Farric Lynx Alpha
--------
Genus: Felines
Group: Felines
Family: The Wilds
--------
Item Level: 83
--------
Right-click to add this to your bestiary.`;

/** Invitations arrive under a broad game class and need pinned category identity. */
export const invitationCategoryFixture = `Item Class: Misc Map Items
Rarity: Normal
Incandescent Invitation
--------
Item Level: 83`;

/** Equipped double-corrupted unique that must keep both corruption implicits. */
export const doubleCorruptedFledglingFixture = `Item Class: Helmets
Rarity: Unique
The Fledgling
Lacquered Helmet
--------
Quality: +20% (augmented)
Armour: 501 (augmented)
Evasion Rating: 501 (augmented)
--------
Requirements:
Level: 72 (gem)
Str: 85 (gem)
Dex: 159
Int: 61 (gem)
--------
Sockets: G-G-R
--------
Item Level: 83
--------
{ Corruption Implicit Modifier }
+1 to Maximum Power Charges
{ Corruption Implicit Modifier — Elemental, Lightning, Ailment }
27(25-30)% increased Effect of Shock
--------
{ Unique Modifier — Defences }
192(120-200)% increased Armour and Evasion
{ Unique Modifier — Speed }
50% increased Projectile Speed
{ Unique Modifier — Damage }
36(30-40)% increased Projectile Damage
Projectiles cannot collide with Enemies in Close Range
Far Shot
--------
Corrupted`;

export const malformedFixture = `Rarity: Rare
Nameless Thing
--------
This is not a complete Path of Exile item
--------
Some future section: value`;
