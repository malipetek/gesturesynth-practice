/**
 * Editorial content for songbook pages.
 *
 * Every song gets an original, human-written writeup grounded in the actual
 * chord data in src/data/songs: an intro, a section-by-section breakdown of
 * the progression, gesture-specific practice tips, and related songs.
 */

export type Difficulty = 'Beginner' | 'Easy' | 'Intermediate' | 'Advanced';

export interface SongSection {
	/** e.g. "Verse", "Chorus", "The whole song" */
	title: string;
	body: string;
}

export interface SongEditorial {
	slug: string;
	difficulty: Difficulty;
	/** One or two sentences on *why* this difficulty. */
	difficultyNote: string;
	/** Opening paragraphs shown right under the song title. */
	intro: string[];
	/** Breakdown of how the chord progression flows. */
	sections: SongSection[];
	/** Gesture-specific practice advice. */
	tips: string[];
	/** Slugs of songs with a similar feel or progression. */
	related: string[];
}

const EDITORIAL: Record<string, SongEditorial> = {
	'twinkle': {
		slug: 'twinkle',
		difficulty: 'Beginner',
		difficultyNote:
			'Three chords, eight bars, and a huge amount of repetition — the ideal first song.',
		intro: [
			'Twinkle Twinkle Little Star is the classic first song for a reason: it only needs three chords, the melody dictates every change, and the whole thing is over in eight bars. On Gesture Synth it is the fastest way to feel the loop between your two hands and the sound coming out.',
			'Because the harmony stays squarely in C major, every chord is a plain major triad. That means your right hand keeps the same 1-finger shape the entire song — the left hand does all the work, which is exactly the kind of focused repetition a beginner needs.',
		],
		sections: [
			{
				title: 'The A section (bars 1–4)',
				body: 'C, F, C, G, back to C. The melody spends its time on the tonic and then climbs through F to set up G — the only real tension in the song. On Gesture Synth this is degree I, IV, I, V, I.',
			},
			{
				title: 'The B section (bars 5–8)',
				body: 'The same shape again: F, C, G, then a final C. It is nearly a repeat of the first four bars, so your second loop through the song is mostly muscle-memory reinforcement.',
			},
		],
		tips: [
			'Keep your right hand on 1 finger the whole song and give all your attention to the left-hand degree changes.',
			'The G chord (degree V) is the one change you will miss — it appears right before the phrase ends, every time.',
			'Count to 100 BPM in your head while you play; every chord lands on beat 1, so there is no strumming pattern to worry about.',
		],
		related: ['amazing-grace', 'ode-to-joy', 'riptide'],
	},
	'amazing-grace': {
		slug: 'amazing-grace',
		difficulty: 'Beginner',
		difficultyNote:
			'A slow hymn with mostly major triads — gentle on the hands even if the melody is beloved.',
		intro: [
			'Amazing Grace is one of the most recognizable melodies in the world, and its harmony is wonderfully kind to a new player: five chords, none of them faster than one per bar, at a stately 70 BPM.',
			'The song is a study in the I–V–vi–IV family of chords. You will move between G, D, Em, C and a single appearance of Am, which keeps the right-hand shapes simple while the left hand walks through almost every scale degree.',
		],
		sections: [
			{
				title: 'The opening (bars 1–4)',
				body: 'G to D to Em, back to G, then a quick trip to C. This is the classic rising hymn gesture: tonic, dominant, then the relative minor as a soft landing before the cadence.',
			},
			{
				title: 'The turn (bars 5–8)',
				body: 'Back through G, D, Em, and now a C before the Am–D–G finish. The Am is the only minor triad in the song and only appears here — it colours the final cadence and is the one shape change to look out for.',
			},
			{
				title: 'The payoff (bars 9–12)',
				body: 'C to Am, then the classic D to G resolution. This is where the phrasing opens up; save a bit of energy for these last four bars.',
			},
		],
		tips: [
			'Every chord is a plain triad, so your right hand stays on 1 finger from start to finish.',
			'The Am in bar 10 is the only moment the left hand needs degree VI (index + pinky) — circle it when you practice the last four bars.',
			'At 70 BPM you have almost a second per chord. Use the extra time to check your wrist tilt and hand shape before the next bar.',
		],
		related: ['twinkle', 'ode-to-joy', 'hallelujah'],
	},
	'ode-to-joy': {
		slug: 'ode-to-joy',
		difficulty: 'Beginner',
		difficultyNote:
			'Diatonic, unhurried, and built from the four most common chords — a great second or third song.',
		intro: [
			'Ode to Joy turns a melody written in 1824 into one of the most teachable chord charts around. The harmony is strictly diatonic to C major, which means every chord is the plain major or minor triad you already know from the beginner songs.',
			'Unlike the loop-based pop songs in the songbook, Ode to Joy actually develops: the first half stays close to home, and the second half ventures up to G and Am before resolving. It is a mini-lesson in musical form disguised as a singalong.',
		],
		sections: [
			{
				title: 'The main theme (bars 1–8)',
				body: 'C, F, C, G, then Am, F, C, G, C. The melody is nearly all stepwise movement, so the chords follow it closely — up to F, over to G, and a gentle brush of Am for colour.',
			},
			{
				title: 'The repeat with a twist (bars 9–18)',
				body: 'The same material returns, but the F appears earlier and the final cadence lands on G before the last C. The feeling is "same tune, bigger ending" — good practice for holding your shapes steady while the harmony leans forward.',
			},
		],
		tips: [
			'Right hand stays at 1 finger throughout; the whole song is triads.',
			'The G (degree V) and Am (degree VI) are the two left-hand shapes to drill — the melody keeps returning to them.',
			'Because the phrases are longer here than in Twinkle, focus on keeping both hands relaxed through the four-bar arcs rather than sprinting.',
		],
		related: ['twinkle', 'amazing-grace', 'let-it-be'],
	},
	'riptide': {
		slug: 'riptide',
		difficulty: 'Beginner',
		difficultyNote:
			'Three chords in a vi–V–I loop at 100 BPM — the whole song is one pattern.',
		intro: [
			'Riptide is the song everyone plays at the campfire, and on Gesture Synth it is almost suspiciously easy: Am, G, C, and nothing else. The entire chart is that three-chord loop, twelve times.',
			'That makes Riptide a perfect song for building speed with confidence. Since the hand shapes never change in quality — every chord is a plain triad — the only job is keeping the left hand on beat as it cycles degree VI, V, and I.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'Am → G → C, repeated for all twelve bars. There is no chorus to learn, no bridge, no key change. If you can play the loop once, you can play the entire song.',
			},
		],
		tips: [
			'This is your first 100 BPM song — the loop moves faster than the hymns, so start with the metronome at half speed.',
			'The Am (degree VI) is the entrance every time, so treat it as your home shape and feel the loop start there.',
			'Since quality never changes, challenge yourself to keep your right hand perfectly still and put all the motion in your left wrist.',
		],
		related: ['let-it-be', 'twinkle', 'with-or-without-you'],
	},
	'let-it-be': {
		slug: 'let-it-be',
		difficulty: 'Beginner',
		difficultyNote:
			'The I–V–vi–IV loop, played slowly with a satisfying chorus variation.',
		intro: [
			'Let It Be is built on the most famous chord progression in pop music: C, G, Am, F — the I–V–vi–IV. If you learn this one loop, you unlock a huge slice of the songbook, because several other songs here use the same four chords.',
			'At 72 BPM it is slower and more spacious than Riptide, which gives you room to think. The chorus swaps the order of the loop, so the song also teaches you to re-orient a pattern you thought you knew.',
		],
		sections: [
			{
				title: 'Verse (bars 1–8)',
				body: 'C → G → Am → F, twice. The loop is so regular you can practically close your eyes — one chord per bar, never a surprise.',
			},
			{
				title: 'Chorus (bars 9–16)',
				body: 'C → G → F → C, then Am → G → F → C. The F gets promoted to beat 1 and the loop resolves home sooner. It is the same four chords in a different order, which is the whole trick of the song.',
			},
		],
		tips: [
			'All four chords are triads — right hand on 1 finger the entire song.',
			'The chorus reordering is the only real challenge; mark bars 9–12 and practice that loop separately before playing the whole song.',
			'Use the slow tempo to work on your wrist-tilt transitions: coming from G, the F and Am both need a clean flip.',
		],
		related: ['with-or-without-you', 'riptide', 'the-scientist'],
	},
	'hallelujah': {
		slug: 'hallelujah',
		difficulty: 'Beginner',
		difficultyNote:
			'Slow, spacious, and mostly diatonic — with one borrowed chord that makes it interesting.',
		intro: [
			'Hallelujah is a folk song in the broadest sense: the chords are simple, the tempo is unhurried, and the emotional weight comes from the spaces between the notes. The chart stays firmly in C major for most of its length.',
			'Then, in the final bars, an E major chord appears where the ear expects something gentler. That single chromatic chord — the harmonic signature of the song — is also the one gesture you have not practiced in the beginner songs.',
		],
		sections: [
			{
				title: 'The verse (bars 1–8)',
				body: 'C → Am, twice, then F → G → C and a second F → G before returning to Am. The C–Am oscillation is the song\u2019s heartbeat; every phrase opens on it.',
			},
			{
				title: 'The turnaround (bars 9–12)',
				body: 'F → G → E → Am. The E major is the surprise: it is the dominant of Am, pulling the harmony down a half-step into the relative minor with real intensity.',
			},
		],
		tips: [
			'The E chord is the boss fight — it is degree III in the major world, a shape you have not needed in the earlier songs.',
			'Count the pickup: several phrases start just before beat 1, so listen to the backing pad and let it pull you in rather than guessing.',
			'Keep the right hand on 1 finger; every chord here is a triad even when the harmony gets spicy.',
		],
		related: ['brooklyn-baby', 'amazing-grace', 'let-it-be'],
	},
	'the-scientist': {
		slug: 'the-scientist',
		difficulty: 'Easy',
		difficultyNote:
			'A slow four-chord loop that adds the relative minor — slightly more hand travel than the beginner set.',
		intro: [
			'The Scientist is a ballad built on a single loop: Dm, Bb, F, C — vi, IV, I, V in F major. Four chords, sixteen bars, zero changes of plan.',
			'It is the perfect next step after Let It Be: the same patient tempo and regular loop, but the progression sits lower in the key, so your left hand spends more time around degrees IV, VI and the tonic.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'Dm → Bb → F → C, repeated four times. Every chord is a plain triad, and the loop is the entire arrangement — the interest comes from phrasing and dynamics, not harmony.',
			},
		],
		tips: [
			'The Dm (degree VI, minor world) and Bb (degree IV, major world) are the two shapes that need a wrist-tilt flip; drill those transitions back to back.',
			'At 73 BPM you have time to set each chord cleanly — use it to check your hand is centred before the next bar.',
			'When the loop feels automatic, try playing the whole song with your eyes closed and count the four-bar phrases.',
		],
		related: ['with-or-without-you', 'let-it-be', 'zombie'],
	},
	'with-or-without-you': {
		slug: 'with-or-without-you',
		difficulty: 'Easy',
		difficultyNote:
			'The same I–V–vi–IV loop as Let It Be, but faster and with the emotional B minor sustained.',
		intro: [
			'With or Without You runs on the exact same engine as Let It Be — D, A, Bm, G — but it sounds completely different. The tempo is faster, the key is lower, and the B minor hangs there for a full bar, giving the loop its aching quality.',
			'If you learned Let It Be first, this song is almost free: the shapes are the same four triads, transposed. The real work is musical, not technical — holding the Bm steady instead of rushing to the next chord.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'D → A → Bm → G, sixteen times. One chord per bar, no variations, no bridge. The entire performance is in how you treat the loop.',
			},
		],
		tips: [
			'Right hand stays on 1 finger; every chord is a triad.',
			'The Bm is degree VI in the minor world — the most expressive chord in the loop, and the easiest to rush. Count a full four beats on it.',
			'110 BPM is brisk for chord changes on a new instrument, so loop just D → A → Bm before adding the G.',
		],
		related: ['let-it-be', 'the-scientist', 'riptide'],
	},
	'brooklyn-baby': {
		slug: 'brooklyn-baby',
		difficulty: 'Easy',
		difficultyNote:
			'All triads in C major, but the progression rambles — good training for following a chart instead of a loop.',
		intro: [
			'Brooklyn Baby is the first song in the songbook that refuses to sit in a neat loop. The chart wanders through C, Em, G, F and back again with an irregular rhythm, which makes it excellent practice for reading a chart live.',
			'The harmony stays entirely in C major and every chord is a plain triad, so the difficulty is not in the shapes — it is in staying oriented as the progression takes the scenic route.',
		],
		sections: [
			{
				title: 'The verse (bars 1–8)',
				body: 'C → Em, twice, then G → Em → C → G. The C to Em move is the signature: the relative minor masquerading as home.',
			},
			{
				title: 'The chorus (bars 9–16)',
				body: 'F → C → F → Em, then G → F → G → C. The chorus leans on F and G — degrees IV and V — which gives it a brighter, more open feel than the verse.',
			},
		],
		tips: [
			'The C (degree I) and G (degree V) appear constantly, so keep those two shapes rock-solid and the song will never fully lose you.',
			'Em is degree III in the major world — it looks like a minor chord but stays in the major world, which is a useful mental distinction.',
			'Practise the verse and chorus as two separate loops first; the chart jumps between them and the transition is the hardest beat.',
		],
		related: ['hallelujah', 'let-it-be', 'creep'],
	},
	'creep': {
		slug: 'creep',
		difficulty: 'Easy',
		difficultyNote:
			'Four chords and a heavy loop, but the chromatic B major and the IV–iv flip demand precision.',
		intro: [
			'Creep is the song that teaches you the power of one wrong-sounding chord done on purpose. The chart is a simple G, B, C, Cm loop — but the B major and the C-to-Cm flip are both chromatic moves that the guitar arrangement plays loud.',
			'That makes Creep a fantastic second-level song: the shapes are few, but you have to hit them squarely, because the B and the Cm are what make the song recognisable.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'G → B → C → Cm, repeated four times. The first three chords are all majors — including B, which borrows from outside the key — and then the loop collapses into the minor iv for a single bar of tension before restarting.',
			},
		],
		tips: [
			'B major is degree III, but it is the chromatic version — the left hand makes a plain major triad on a degree that the key of G would normally make minor. Trust the chart, not your theory instincts.',
			'The Cm is the emotional peak of every loop: degree IV, minor world, one bar. Arrive at it cleanly and hold it.',
			'Every chord is a triad, so the right hand never changes — this song is a left-hand and wrist-tilt workout.',
		],
		related: ['zombie', 'let-down', 'brooklyn-baby'],
	},
	'blinding-lights': {
		slug: 'blinding-lights',
		difficulty: 'Intermediate',
		difficultyNote:
			'A minor-key four-chord loop at 86 BPM with two-flat key geography — new territory for most players.',
		intro: [
			'Blinding Lights is one of the most-played songs of the 2020s, and its chart is a textbook minor-key loop: Fm, Cm, Eb, Bb, on repeat. Every chord is a triad, but the key of F minor puts degrees VI and VII into play in a way the C-major songs never did.',
			'The song is pure repetition — sixteen bars, four chords, one idea — so the challenge is consistency. You will play the same loop for the entire chart, which is exactly why it builds stamina.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'Fm → Cm → Eb → Bb, four times. The loop descends in fourths, which is the disco-era harmonic engine: every chord falls naturally into the next, so once your hands learn the pattern it carries itself.',
			},
		],
		tips: [
			'Three of the four chords are in the minor world — Fm (degree I), Cm (IV), and Eb (VI) — so your wrist tilt will spend most of the song flipped.',
			'The Bb (degree VII) is the odd one out: a major triad in the minor world. Practice the Eb → Bb transition on its own.',
			'Keep the right hand on 1 finger and let the left hand own the groove; the loop is simple enough that you can start focusing on staying exactly on the beat.',
		],
		related: ['get-lucky', 'zombie', 'the-nights'],
	},
	'get-lucky': {
		slug: 'get-lucky',
		difficulty: 'Intermediate',
		difficultyNote:
			'Fast, funky, and minor-key — 116 BPM with a four-chord loop that rewards clean transitions.',
		intro: [
			'Get Lucky is the Nile Rodgers guitar riff turned into a songbook chart: Bm, D, F#m, E, looping for all sixteen bars. The tempo is the highest you have seen since the beginner songs, and the minor-key shapes keep your left hand busy.',
			'Every chord is a triad, which keeps the right hand calm, but at 116 BPM the left hand has to move fast and land square. It is the song where the practice starts to feel like playing.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'Bm → D → F#m → E, four times through. A i–III–v–VII loop in B minor: the minor tonic, a bright major lift, and a dominant-flavoured return.',
			},
		],
		tips: [
			'Start at 80 BPM and work up — the loop is mechanical, so the only variable is your hands\u2019 speed.',
			'The F#m (degree V, minor world) is the sneakiest shape; it is easy to flatten into the wrong degree when you are moving fast.',
			'Because the song is a loop, use the metronome and measure yourself: the goal is to stay locked for all sixteen bars without dropping the D.',
		],
		related: ['blinding-lights', 'the-nights', 'koca-bir-sacmalik'],
	},
	'zombie': {
		slug: 'zombie',
		difficulty: 'Intermediate',
		difficultyNote:
			'A grunge-power-chord loop in E minor, with a slash chord that moves the bass under the same shape.',
		intro: [
			'Zombie is a song of one loop and one mood. The chart cycles Em, C, G, D/F# for all sixteen bars, and the whole arrangement — the famous delay-soaked riff, the driving drums — hangs off that single progression.',
			'It is the first song in the songbook with a slash chord: D/F# is still a D major triad, but it sits over an F# bass. In gesture terms the shape is the same D major; the bass note is the synth engine\u2019s job, not yours.',
		],
		sections: [
			{
				title: 'The whole song',
				body: 'Em → C → G → D/F#, repeated four times. A i–VI–III–VII loop in E minor that keeps walking the harmony back down to the tonic — relentlessly.',
			},
		],
		tips: [
			'Three of the four chords are in the minor world: Em (degree I), C (VI), and G (III). Only the D is a major-world chord.',
			'The D/F# reads as D in the chart — do not hunt for a special shape; play the plain D triad and let the engine handle the bass.',
			'Practice the G → D transition until it is instant; it is the pivot the loop returns to every four bars.',
		],
		related: ['creep', 'blinding-lights', 'the-scientist'],
	},
	'let-down': {
		slug: 'let-down',
		difficulty: 'Intermediate',
		difficultyNote:
			'Adds sus2 and slash chords to the mix, plus more changes per bar than anything before it.',
		intro: [
			'Let Down is where the songbook starts asking for chord qualities beyond the plain triad. The verse cycles A, E, F#m, E, but the chorus brings in Dsus2 and D/F# — suspended and slash chords that change both the right-hand shape and the way you think about the chart.',
			'It is also the first song with chords that shift mid-bar in places, so the reading challenge is real. The payoff is a Radiohead chart that actually sounds like Radiohead.',
		],
		sections: [
			{
				title: 'Verse (bars 1–8)',
				body: 'A → E → F#m → E, twice. The classic I–V–vi–V in A major — a familiar loop, played at a patient 84 BPM.',
			},
			{
				title: 'Chorus (bars 9–16)',
				body: 'D → Dsus2 → A → D/F#, then the same idea again, and a run back through the verse. The Dsus2 toggles the right-hand quality from triad to suspended, and the D/F# keeps the bass moving.',
			},
		],
		tips: [
			'Dsus2 is the first non-triad in the songbook: it is quality 3 in the major world — the same finger shape you will later use for seventh chords.',
			'The A → E → F#m → E verse loop is your warm-up; get it automatic before touching the chorus.',
			'Slash chords like D/F# are just their root chord — play D and trust the engine for the bass note.',
		],
		related: ['creep', 'the-nights', 'hallelujah'],
	},
	'the-nights': {
		slug: 'the-nights',
		difficulty: 'Advanced',
		difficultyNote:
			'126 BPM with nearly fifty chord changes — the fastest and most demanding chart in the songbook.',
		intro: [
			'The Nights is the endurance test of the songbook. At 126 BPM with close to fifty chord changes across sixteen bars, it moves faster than anything else here, and it asks for real precision on every transition.',
			'The structure is still a loop — mostly C#m to B with a middle section that stretches out through A, E, and B — but the pace turns that simple harmony into a genuine workout.',
		],
		sections: [
			{
				title: 'The verse loop (bars 1–8)',
				body: 'C#m → B, repeated. Two chords, but at 126 BPM each bar comes fast, and the i–VII alternation never lets your left hand rest.',
			},
			{
				title: 'The lift (bars 9–16)',
				body: 'C#m → A → E → B, twice, then the verse loop again to close. The chorus opens the harmony up to the subdominant and the dominant before snapping back to the two-chord groove.',
			},
		],
		tips: [
			'Learn the C#m → B loop at 60 BPM and only speed up when you can land ten clean cycles in a row.',
			'The A (degree VI) is the one major-world chord in an otherwise minor loop — a single wrist flip at the start of the chorus.',
			'At this tempo, anticipation is everything: move your left hand during the previous beat, not after the chord lands.',
		],
		related: ['koca-bir-sacmalik', 'get-lucky', 'blinding-lights'],
	},
	'koca-bir-sacmalik': {
		slug: 'koca-bir-sacmalik',
		difficulty: 'Advanced',
		difficultyNote:
			'Forty-nine chord changes in sixteen bars at 112 BPM — the densest chart in the songbook.',
		intro: [
			'Koca Bi Saçmalık is a chart that does not let up. Where most songs change chord every bar, this one changes almost every beat — forty-nine changes in sixteen bars at 112 BPM.',
			'The harmony itself is a small set — Bb, C, Am, with Gm visiting — but the pace turns those four chords into a genuinely advanced coordination drill.',
		],
		sections: [
			{
				title: 'The groove (bars 1–8)',
				body: 'The Bb → C → Am pattern repeats almost immediately, with the chords landing on nearly every beat. It is a two-and-a-half-bar phrase that restarts before you have time to relax.',
			},
			{
				title: 'The Gm detour (bars 9–16)',
				body: 'The same Bb → C → Am engine, but Gm (degree V in the minor world) drops in where the ear expects Am, shifting the colour of the loop.',
			},
		],
		tips: [
			'This is a quarter-note choreography piece: practice each two-bar phrase slowly, beat by beat, before attempting the full speed.',
			'There is no time to reset between changes, so keep both hands hovering over their home shapes rather than dropping them.',
			'If the full chart is out of reach, pick any four-bar loop and play it until it is automatic — that is the real unit of this song.',
		],
		related: ['the-nights', 'get-lucky', 'blinding-lights'],
	},
};

export function getEditorial(song: { slug: string }): SongEditorial | undefined {
	return EDITORIAL[song.slug];
}
