# 01 · Pulse

Un générateur de sons qui bat, construit avec la Web Audio API, sans aucune librairie.

**[Essayer en ligne](https://withren.github.io/devtober/day-01-pulse/)**

## Ce qu'on peut faire

- **Générateur** : choisir une fréquence de 20 Hz à 4 kHz, une forme d'onde (sinus, triangle, carré, dent de scie) et une deuxième voix (octave, quinte, ou une fréquence presque identique qui crée un battement acoustique).
- **Presets** : Cœur, Sonar, Alarme, Basse, Respire, Radio.
- **Ton son** : déposer un fichier audio (mp3, wav, ogg…) n'importe où sur la page, puis le modifier : vitesse et hauteur, lecture à l'envers.
- **Battement** : tempo de 20 à 240 BPM, intensité et forme (cœur « lub-dub », impulsion, vague, hachoir). Il s'applique au générateur comme à ton son.
- **Filtre passe-bas** et volume.
- `Espace` pour lancer ou couper.
- **Timeline** : « Ajouter le son actuel » enregistre le son tel qu'il est réglé (avec battement et filtre) et le pose sous la tête de lecture. On peut aussi déposer un fichier directement sur une des 4 pistes. Les sons se déplacent à la souris (avec magnétisme sur les bords, `Alt` pour le couper), se raccourcissent par leurs bords, se coupent par double-clic ou avec `C`, et s'effacent avec `Suppr`. « Écouter » joue le tout, « Exporter en WAV » télécharge le mix.

## Comment c'est codé

La chaîne audio : `source → gain du battement → filtre passe-bas → volume → analyseur → sortie`.

Le battement n'est pas un simple oscillateur basse fréquence. Chaque forme est une courbe de points `[temps, niveau]`, et un planificateur appelé toutes les 25 ms programme ces rampes sur le gain avec `linearRampToValueAtTime`, 150 ms à l'avance. Le rythme reste ainsi parfaitement régulier même si le navigateur ralentit.

Pour la timeline, chaque son ajouté est rendu une fois dans un `AudioBuffer` avec un `OfflineAudioContext` (la même chaîne qu'en direct, mais hors temps réel). Un clip n'est qu'une fenêtre sur ce buffer : `start` (position sur la timeline), `offset` (début dans le buffer) et `dur`. Couper ou raccourcir ne modifie jamais l'audio, seulement ces trois nombres. À la lecture, chaque clip devient un `AudioBufferSourceNode` démarré avec `start(quand, offset, durée)`, avec des fondus de 5 ms pour éviter les clics aux coupes. L'export rejoue la même planification dans un `OfflineAudioContext` et encode le résultat en WAV 16 bits.

La visualisation lit l'analyseur à chaque image : l'anneau prend la forme de l'onde réelle, son rayon suit le volume (RMS), et une onde part du centre à chaque battement.

Pour la lecture à l'envers, une copie inversée du fichier est préparée au chargement.

## Le lien avec le mot

Un *pulse*, c'est à la fois une pulsation (le cœur, le tempo) et une vibration (la fréquence en hertz, des pulsations par seconde). Ici les deux se superposent : une onde qui vibre des centaines de fois par seconde, rythmée par un battement de cœur.
