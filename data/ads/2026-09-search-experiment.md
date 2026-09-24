# Google Ads: the first experiment (September 2026)

One question: what does a confirmed newsletter subscriber cost through Google search ads, and does the landing page
matter? Two ad groups, two weeks, about $70. Everything below is copy-paste ready for the Google Ads UI. Google
gets nothing on the site: no tag, no click id, no conversion import. Google reports clicks and spend; the site
reports subscribers per tag (`npm run newsletter:sources`); divide by hand.

## Account settings (once)

- Campaign type: **Search**. Goal: "Create a campaign without a goal's guidance" (avoids the conversion-tag
  prompts). Skip Performance Max and any "expert mode" upsell.
- Networks: untick **Display Network** and **Search partners**. Google ticks both by default.
- Bidding: **Maximize clicks** with a maximum CPC bid limit of **$1.00**. (Manual CPC works too; Google is
  hiding it further every year.)
- Budget: **$5.00 a day**. Start and end dates: 14 days. Google may spend up to twice the daily budget on a
  given day, never more than 30.4 x daily in a month, so the ceiling is about $70.
- Locations: United States, Canada, United Kingdom, Israel, Australia. Under location options choose
  **Presence** ("people in or regularly in your targeted locations"), not "interest".
- Language: English.
- Ad schedule: all days, all hours. Readers learn before dawn and after midnight.
- Under Settings, **Auto-applied recommendations: turn every one off**. Google will otherwise add broad-match
  keywords and rewrite the ads within days.
- Auto-tagging can stay on. The `gclid` lands in the URL and the site ignores it; only `src` is read.
- Ad rotation: "Do not optimize: rotate ads indefinitely", so both ads in a group get shown.
- Sitelinks, callouts, images: skip for the experiment.

## Ad group 1: "Daily email"

Final URL: `https://daf-yomi.dev/newsletter?src=ga-news-2026-09`
(exact lower-case path, no trailing slash: the site's redirect for anything else drops the tag)

Keywords (add each as both "phrase" and [exact]):

    daf yomi email
    daf yomi newsletter
    daily daf email
    daf yomi summary
    daf yomi in english
    today's daf
    daf yomi today
    daily daf

Responsive search ad, group 1:

Headlines (30 characters each, Google needs at least three; pin nothing):

    Today's Daf, by Email
    The Daily Daf in English
    One Page of Talmud a Day
    Free, No Account, No Ads
    A Short Note on Each Daf
    Text from Sefaria

Descriptions (90 characters each):

    Today's daf from Sefaria's Davidson Talmud, and a short note written by an AI, labelled.
    One email a day, a forty second read, one click to stop. Nothing tracked or sold. Free.

## Ad group 2: "Today's daf"

Final URL: `https://daf-yomi.dev/?src=ga-daf-2026-09`

Keywords (phrase and exact):

    daf yomi
    daf yomi today
    today's daf
    daf yomi english
    daf yomi online
    bekhorot daf yomi

(Swap the tractate keyword when the cycle moves on. Bekhorot runs through the experiment window.)

Responsive search ad, group 2:

Headlines:

    Today's Daf Yomi in English
    The Daf, Read Online Free
    Bekhorot, One Page a Day
    Talmud Text from Sefaria
    A Map of the Page, Labelled AI
    No Account, No Tracking

Descriptions:

    Today's daf in English and the original, from Sefaria. Note and map of the page, AI, labelled.
    Free and non-commercial. Read the page, then get the note by email if you want it.

## Negative keywords (campaign level)

    app
    shiur
    audio
    podcast
    video
    youtube
    artscroll
    schottenstein
    koren
    buy
    pdf
    download
    jobs
    calendar
    schedule
    hebrew
    yiddish

("calendar" and "schedule" send people looking for the cycle's dates, not the text. Hebrew and Yiddish readers land
on an English page today; take those two off once `/he` is public.)

## What to read after 14 days

Google side (Campaigns, then the ad group tab): impressions, clicks, average CPC, cost, per ad group. Also the
Search terms report, to see which real queries the phrase-match keywords caught; add the junk to negatives.

Site side:

    npm run newsletter:sources

`ga-news-2026-09` and `ga-daf-2026-09` rows, `last30d` column. Cost per confirmed subscriber is that ad group's
cost divided by its `last30d`. Also worth a glance: Cloudflare Web Analytics, visits to `/newsletter` on those
days versus the week before.

The organic baseline to beat: before the inline box existed, about 150 human visits produced 2 sign-ups
(NEWSLETTER.md, 2026-09-21). I would call the experiment a clear win under $5 a subscriber, a maybe up to $15,
and not worth repeating above that, though a Daf Yomi reader who stays for the cycle is worth more than a typical
newsletter subscriber, so the bar can be argued.

What I am uncertain about: the CPC range ($0.30 to $1.50 a click is a guess from small religious-education
advertisers, not from data on these exact keywords), and the search volume (the core terms may only draw a few
thousand English searches a month worldwide, in which case $5 a day will not all get spent, and that is itself
an answer).

## After the experiment

Pause the campaign rather than deleting it, so the numbers stay readable. The tag rows stay in D1 either way.
