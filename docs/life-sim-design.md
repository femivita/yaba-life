# Life sim design

How Yaba Life borrows from The Sims, and where it bends the rules for Lagos.

## What The Sims does, and what we took

| Sims idea | How it works there | Yaba Life |
| --- | --- | --- |
| Motives (needs) | Bars for hunger, energy, hygiene, bladder, fun and social that drain over time; when they run out you get an accident, pass out or (in older games) die. | The same six bars, `src/sim/State.ts`. Drain is per game hour and gets faster at work. Hitting zero has a local price: an empty stomach means fainting and a ₦12,000 bill at the Army hospital, no sleep means passing out (and maybe a pickpocket), a full bladder means an accident and a hygiene crash. |
| Mood and moodlets | Overall mood is the sum of needs plus temporary buffs ("Inspired", "Embarrassed"). The plumbob over the head shows it. | `Life.mood` combines needs with buffs such as "Full belle", "Sweet match", "Owing rent" and "Light don come". The green gem above Tunde's head is the plumbob. |
| Smart objects | Objects advertise what they offer ("Eat", "Sleep", "Watch TV") and the price in time and need gain. | Every room is built from objects with offers (`src/sim/Places.ts`): the bed, the bucket bath, the buka counter, the bar's football screen, the CcHUB desks. Picking one walks Tunde there, plays the right pose and runs the clock. |
| Rabbit-hole careers | You go to work, the Sim vanishes for the shift, and performance and promotions depend on skills, mood and the work style you pick. | Four jobs (`src/sim/Jobs.ts`): market sales boy at Yaba Market, danfo conductor at the Yaba terminal, barman at Banilux, junior developer at CcHUB. Each has 4 levels, a schedule, a pay per shift in naira, a work style (work hard, normal, gist with colleagues) and random events. Missing shifts loses performance; too low and you are sacked. |
| Skills | Practise to level up, which unlocks better jobs and actions. | Coding, Hustle, Charisma and Cooking. The tech job needs Coding 2; jollof needs Cooking 3; asking for help needs a good relationship. |
| Wants / aspirations | Short goals that pay out when done. | A rolling list of wants ("Eat amala at White House", "Collect your first pay", "Watch a match at a bar") with naira rewards. |
| Relationships | Friendship bar that social actions move up or down, with acceptance depending on the current level. | Talk to anyone: greet, gist, joke, talk football, hail them, ask advice, ask for small help or throw shade (`src/npc/Social.ts`). Replies are in Pidgin. |
| Cutaway walls | The camera sees into rooms by cutting walls between it and the Sim. | Interiors are their own small scenes; walls facing the camera fade away. |

## Lagos rules

- **Money**: you start with ₦30,000. Rent is ₦17,500 a week to Baba the landlord (about ₦900k a year for a self-contain in Yaba). After a week unpaid he locks you out.
- **NEPA**: power at home is on for about half of each 3-hour block. No light means no fan, no TV and no laptop unless you buy generator fuel (₦2,500 for 6 hours).
- **Getting around**: walk, danfo (from ₦300), keke (from ₦400) or Bolt, with go-slow in the morning and evening rush.
- **Street hustle**: anyone can hawk pure water for small money between jobs.
- **Time**: one game hour is about one real minute at normal speed, with 4× and 12× fast-forward, like The Sims.

## Keeping it light

- Interiors are separate small scenes; the city is hidden while you are inside.
- People are MakeHuman CC0 models cloned from a shared cache, with per-person clothing tints, and their animation slows down or stops with distance.
- Landmarks, bridges and gates are merged into a single vertex-coloured mesh; danfos are instanced.

## Sources

- The Sims motives: <https://sims.fandom.com/wiki/Motive>
- The Sims 4 careers and work performance: <https://help.ea.com/en/articles/the-sims/the-sims-4/careers/>
- Life sim design overview: <https://the-decoder.com/> (life simulation games feature)
- UNILAG campus architecture: <https://transnationalarchitecture.group/> (University of Lagos)
- Tejuosho Market rebuild: The Guardian Nigeria
- Yaba Bus Terminal: Wikipedia
