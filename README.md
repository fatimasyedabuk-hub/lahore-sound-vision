# Lahore, in 88 seconds
Design with Sound & Vision (individual lab). A sound portrait of Lahore, Pakistan.

**Part A, soundscape:** `assets/audio/lahore-soundscape.mp3` (88 s). Five field recordings layered into one piece: rooftop crows, the call to prayer, the bazaar, a food street, traffic, and back to the crows. `tools/build_audio.py` shows how it was made (levelling, reverb, crossfades, volume automation, mixdown).

**Part B, visualscape:** `index.html`. The photographs react to the sound.
- HTML5 `<audio>` with custom controls: play/pause, seek, volume, mute, jump to a scene, keyboard shortcuts.
- Web Audio API analyser: loudness changes the photo's scale and colour, the blurred background, and the bars around the arch.
- Scene changes follow the playhead (photos crossfade).
- "Mix it yourself": five looping sounds with on/off and volume; the picture follows the loudest one.
- Mouse parallax and click ripples. Respects reduced motion.

## Run it
Use a local server (browsers block live audio analysis on `file://`; the page still works there with a simpler fallback):
```
python3 -m http.server 8000     # then open http://localhost:8000
```
## Publish (GitHub Pages)
```
git init && git add . && git commit -m "Class Progress."
git branch -M main && git remote add origin <repo url> && git push -u origin main
```
Repo Settings > Pages > Deploy from branch `main` / root.

Credits: see `CREDITS.md`.
