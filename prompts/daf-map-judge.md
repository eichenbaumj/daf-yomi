# The judge of the map: does it fit the page?

You are given the complete English text of a page of Talmud, one numbered
segment at a time, and the map that was drawn of it: the page cut into
units, each with the ids of its first and last segment, a kind, a title and
a one-sentence gloss, and one sentence on the shape of the whole page. You
read the page and say where the map is wrong. Every complaint points at exact
words: a segment id, and up to 25 words copied exactly from that segment. A
complaint you cannot point to is not reported. You are not asked whether you
would have drawn the map differently; you are asked whether this map fits
this page.

## 1. Boundaries

A unit should begin where the argument turns to something else. Report a
unit that begins in the middle of a move, or that runs on past the turn into
the next one, with `unit` (its number), `turnsAt` (the id of the segment
where the move really turns), `pageSays` (up to 25 words copied exactly from
that segment) and one line of explanation. A boundary that sits a segment
early or late because the page's own mark (§, MISHNA:, GEMARA:) sits there
is not a complaint: the marks are fixed. A coarse unit that holds a question
and its answers, or a dispute with its proofs, is not a complaint either;
the map is a table of contents, and five to nine units is the house style.

## 2. Kinds

Report a unit whose kind the page's words contradict: a "dispute" where only
one voice speaks, a "ruling" that is only a proposal, a "story" that is a
legal case with no one in it, an "answer" where the page only asks. Give
`unit`, `is` (the kind it should be, from the same list: mishna, reading,
question, answer, objection, proof, dispute, case, story, digression,
ruling, open), `pageSays` (up to 25 words copied exactly from the unit's
segments that show it) and one line. A unit that could fairly be called two
things is not a complaint.

## 3. Glosses and titles

Report a title or gloss that states something the page contradicts or never
says: the wrong sage, the wrong verse, a conclusion the page does not reach.
Give `unit`, `claim` (copied exactly from the title or gloss), `pageSays`
(up to 25 words copied exactly from the page that contradict it or show what
the page says instead) and one line. Matters of emphasis, selection, or
what a gloss leaves out are not problems; a gloss is one sentence.

## 4. The shape

`shapeFits` is true when the shape sentence describes this page and not a
generic page of Gemara. When it is false, `shapeNote` says in one line what
the page does that the sentence misses.

## 5. The verdict

`modelVerdict` is redraw when any boundary, kind or gloss complaint stands,
or the shape does not fit; otherwise keep. `feedback`, when redraw: two or
three plain sentences on what the redrawn map must do, naming the units.
Otherwise empty.
