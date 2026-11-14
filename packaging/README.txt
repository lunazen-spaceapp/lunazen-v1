LunaZen Landing Site Navigator: packaged build
==============================================

Start here
----------
Live app:        https://lunazen-v1.vercel.app
Overview video:  https://youtu.be/3MQQRflfRCE
The guide:       lunazen_guide.pdf (the user guide; page 1 is a one-page summary)
Video series:    https://www.youtube.com/playlist?list=PLct6-XOWUjH8 (six videos on the south polar sky; they explain the concepts, not the app)

This folder is the app. It runs in the browser and sends nothing anywhere. The pages need a web server (browsers block the data
files over file://), so start the small local server below, then open http://localhost:8000/ in a recent Chrome, Edge, Firefox
or Safari. The 3D tab needs WebGL2.

Start
-----
  macOS / Linux:   ./start.sh             (uses python3, or node if python3 is not installed)
  Windows:         double-click start.bat (needs Python 3 from python.org)
  Any system:      python3 -m http.server 8000      or      node serve.mjs 8000

Stop the server with Ctrl+C.

Where to look
-------------
  Learn:  Map, Explorer (the sky from one spot), Whole Moon
  Plan:   Planner (when to land, one spot), Rank (all 67 spots for one landing), Delay impact,
          Compare landings (landings you pinned), Compare sites (several sites over the same dates)
  Resources: the guides, the site rule, the data, what it covers, the videos and the evidence table; from there the Evidence
            page shows the checks against JPL Horizons, NASA's LOLA maps, Apollo records and real landings
  Contact: the team and how to reach it
  lunazen_guide.pdf: "LunaZen: User Guide"
  (how_the_app_works.pdf, the old name, is a copy of the user guide)

Things worth trying
-------------------
The Plan pages open on Site01-1 from 15 March 2027, the date the guide's walkthroughs use.
  1. Planner: the default question finds no landing within 100 m at Site01-1 (18% of landing times work at the spot). The
     suggestions under it offer DM2-4 (9 landing days, the first on 7 April), a lander that tolerates 253 h of darkness, and a
     smaller miss distance (2 landing times work within 50 m, the first on 9 April). Click one. Press the pin icon on a landing that works.
  2. Compare landings: enter 9 in the shift box and press Rerun pins to see what a nine-day slip does to each pinned landing.
  3. Delay impact: Site01-1 fails on 15 March (DSN in view too low); the next working day is 2 April, 18 days later.
  4. Explorer: Site01-1 on 1 March 2027 at 06:15 UTC: the Sun sets in 36 h 15 min and Earth rises in 3 d 18 h.
  5. Map: click inside a mapped site, press "Use point" to trace your own point, and save it to My points.

Source code and reproduction
----------------------------
The pipeline, notebooks, validation scripts and tests are in the source repository, not in this build:
https://github.com/lunazen-spaceapp/lunazen-v1

Notes
-----
  - Dates run from 2024 to 2043. There is no lander power or thermal model: a lander is judged against a darkness tolerance
    (5 h, what Blue Ghost 1 survived; 50 h, VIPER's design figure) or hours you enter.
  - Nothing is stored except your pins, saved spots and theme choice, in your browser's local storage.
  - To report a problem, send the page address (use "Copy link"), what you expected and what you saw.
