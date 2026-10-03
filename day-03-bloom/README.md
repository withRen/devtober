# 03 · Bloom

Une chambre noire dans le navigateur : ouvre une photo ou un RAW, développe-la, puis ajoute du bloom. Le bloom, c'est la lumière qui déborde des zones les plus vives, comme dans un objectif. Tout le calcul se fait sur la carte graphique (WebGPU), et l'export se fait en pleine résolution.

## Ce qu'on peut faire

- **Ouvrir** une photo par le bouton, en la glissant sur l'aperçu ou en la collant : JPEG, PNG, WebP, AVIF, **HDR Radiance** (`.hdr`) et **RAW** (CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF, PEF… tout ce que lit LibRaw). Au démarrage, une démo : une enseigne au néon générée en HDR.
- **Deux interfaces**, au choix dans le menu « ··· » (le choix est retenu) :
  - **Épurée**, dans l'esprit de Luminar (par défaut) : gris anthracite, l'image posée sur un fond plus clair, deux vues (Préréglages, avec toutes les miniatures de bloom et de LUT ; Retouche, avec les outils rangés par familles : Essentiels, Créatif, Professionnel). Chaque outil tient sur une ligne qui se déplie sur place, avec un œil pour le désactiver et une flèche pour le réinitialiser.
  - **Chambre noire** : l'image bord à bord sur fond noir, une pile de modules repliables à droite (Lumière, Couleur, Courbes, LUT, Bruit IA, Bloom, Rendu, Infos), chacun avec un bouton marche/arrêt qui le court-circuite sans perdre ses réglages et un point quand il est modifié. L'exposition se règle sur un cadran gradué en arc, avec l'histogramme courbé dessous ; la quantité de bloom, la force du débruitage et l'intensité de la LUT sur des molettes. Un rail d'outils sur le bord gauche : avant/après, maintenir pour voir l'original, afficher ou masquer les réglages.
- **Lumière** : exposition, contraste, hautes lumières, ombres, blancs, noirs.
- **Couleur** : température et teinte (balance des blancs), vibrance, saturation.
- **Réglages locaux** (calques) : jusqu'à 8 calques, chacun avec ses réglages (exposition, contraste, hautes lumières, ombres, température, teinte, saturation, vibrance, et bloom local), son opacité et un masque. Le masque multiplie une forme (radiale ou dégradé, avec des poignées à glisser sur la photo : centre, rayons, rotation, transition) par une plage de luminance ou de couleur (choisie à la pipette), comme une fenêtre et un qualificateur dans DaVinci. On peut l'inverser et l'afficher en rouge (`M`). Cinq départs tout prêts : Ciel, Sujet, Ombres, Hautes lumières, Néons.
- **Courbes** : une courbe RVB et une par canal (rouge, vert, bleu), sur l'histogramme du canal. Clic pour ajouter un point, glisser pour le déplacer, double-clic ou glisser hors du cadre pour le retirer, flèches et `Suppr` au clavier. Quatre formes toutes prêtes : Linéaire, Contraste en S, Contraste fort, Mat.
- **LUT** : une galerie de 8 LUT faites maison (Sarcelle et orange, Pellicule chaude, Pellicule froide, Délavé, Sans blanchiment, Nuit américaine, Noir et blanc, Sépia) et les tiennes : import de `.cube` (3D ou 1D) et de HaldCLUT en PNG, par le bouton ou en glissant un `.cube` sur la photo. Les LUT importées restent dans le navigateur. Miniatures rendues sur ta photo, intensité réglable, et l'espace que la LUT attend : sRGB / Rec.709 (LUT créatives, appliquées après tous les réglages) ou S-Log3, LogC3, V-Log (LUT de conversion pour caméra, qui partent de la lumière de la scène et remplacent le rendu des hautes lumières). **Export de l'étalonnage en `.cube`** 33³, pour DaVinci Resolve, Premiere ou Final Cut.
- **Réduction du bruit par IA** (onglet Détail) : un réseau de neurones, FFDNet, qui tourne sur la carte graphique. Une loupe à 100 % montre le résultat tout de suite, sur la zone choisie d'un clic sur la photo ; on maintient un bouton pour revoir l'original. L'image entière est calculée en arrière-plan, avec la progression dans la barre flottante, et l'export attend la fin du calcul. Réglages : force (proposée d'après l'ISO de la photo), luminance et couleur séparées.
- **Bloom**, en couches qu'on empile :
  - **Halo** : la lueur classique autour des sources vives ;
  - **Anamorphique** : de longues traînées horizontales et bleutées, comme avec un objectif de cinéma ;
  - **Étoile** : des aigrettes de diffraction, de 4 à 12 branches ;
  - **Halation** : le halo rouge-orangé de la pellicule autour des hautes lumières ;
  - **Brume** : une diffusion douce de toute l'image, en mode « écran » (effet Orton ou filtre Pro-Mist).

  Chaque couche a son intensité, son seuil, la douceur du seuil, son rayon ou sa longueur, son angle, sa teinte et son mode de mélange. On peut la masquer, la monter ou la supprimer.
- **8 préréglages** avec miniatures rendues sur ta photo : Sans bloom, Halo doux, Néon, Anamorphique, Étoile, Pellicule, Rêve, Tout à la fois.
- **Énergie des hautes lumières** : un JPEG plafonne au blanc, donc une lampe et un mur blanc y ont la même valeur. Ce réglage redonne de l'énergie à ce qui frôle le blanc, pour le bloom seulement.
- **Rendu** des hautes lumières : Standard (coupe net au blanc), Doux (épaule douce) ou AgX (réponse type film). Plus une vignette et du grain.
- **Avant / après** (`Y`) : un curseur à glisser sur l'image.
- **Histogramme** en direct, avec un point rouge si des pixels sont bouchés ou brûlés, et les infos de prise de vue (ISO, vitesse, ouverture, focale) lues dans les EXIF ou le RAW.
- **Historique** : annuler (`⌘Z`), rétablir (`⇧⌘Z`). Double-clic sur un curseur pour le remettre à zéro.
- **Export** : JPEG ou PNG en pleine résolution, ou JPEG de 2 048 px pour le web.

## Comment c'est codé

- **Une image linéaire, du début à la fin du développement.** Le JPEG est converti de sRGB en linéaire, le RAW sort de LibRaw déjà linéaire (16 bits, balance des blancs de l'appareil, primaires sRGB). Exposition, balance des blancs et bloom se calculent dans la lumière de la scène. Le tone mapping vient ensuite, puis les réglages d'affichage (contraste, ombres…) en sRGB, là où ils se comportent comme on s'y attend.
- **Source, base et aperçu.** La source part une fois sur la carte graphique, en pleine résolution (8 bits, 16 bits entiers ou demi-flottants). On en tire une « base » linéaire de 4 096 px au plus, avec tous ses niveaux de mip, que l'aperçu échantillonne à la taille de l'écran.
- **Le bloom ne dépend pas de la taille de sortie.** Il se calcule sur une version de 2 048 px au plus, la même pour l'aperçu, les miniatures et l'export, puis il est lu en coordonnées relatives. Le halo a donc exactement la même forme à l'écran et dans le fichier final. Il n'est recalculé que si un réglage en amont change : bouger le contraste ne le refait pas.
- **Halo** : seuil à genou doux, puis une chaîne de réductions à 13 lectures (la méthode de *Call of Duty: Advanced Warfare*) et de remontées en filtre « tente ». À chaque remontée, le niveau du dessous est mélangé au niveau courant, et ce mélange règle le rayon.
- **Traînées et étoiles** : le filtre de Kawase. Quatre lectures le long d'une direction, avec un pas multiplié par quatre à chaque passe (1, 4, 16, 64, 256 pixels), et des poids qui décroissent en exponentielle. Une direction de chaque côté pour l'anamorphique, une par branche pour l'étoile.
- **Accumulation** : chaque couche s'ajoute par un mélange additif, dans un tampon « ajout » ou un tampon « écran » selon son mode.
- **Export par tuiles de 2 048 px** : chaque tuile repart de la source pleine résolution, se développe, lit le bloom à sa position, puis revient au processeur et se colle dans un canvas. Une photo de 24 Mpx s'exporte en 2,6 secondes environ.
- **RAW** : [LibRaw](https://www.libraw.org) compilé en WebAssembly ([LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm), copié dans `vendor/`). Il tourne dans un worker, sur plusieurs threads. L'exposition de départ ramène le 99ᵉ centile vers le blanc, comme dcraw, sans jamais assombrir. Un RAW de 24 Mpx se décode en 2,5 secondes environ.
- **Calques locaux** : tout dans le shader de finition, pixel par pixel. Les masques (ellipse tournée, dégradé, plage de luminance, distance de teinte sur le cercle avec une saturation minimale) sont calculés une fois sur l'image avant bloom et réglages, pour qu'ils ne bougent pas quand on règle le calque. Le bloom local module l'apport du bloom avant le rendu des hautes lumières ; les autres réglages s'appliquent en valeurs d'affichage, après les réglages globaux et avant la LUT. Les 8 calques tiennent dans un tampon d'uniformes de 1 Ko. Comme tout ne dépend que de la position relative, l'export par tuiles reste exact.
- **Courbes** : interpolation cubique monotone (Fritsch-Carlson), qui passe par chaque point sans jamais dépasser entre deux. Les quatre courbes sont combinées en une table de 1 024 valeurs (rouge = R(RVB(x)), et ainsi de suite), envoyée en texture et lue par le shader de finition, après le contraste et avant la saturation. La table n'est renvoyée que si une courbe change.
- **LUT** : une texture 3D en demi-flottants, lue en trilinéaire au centre des texels. Le `.cube` est lu ligne par ligne (`DOMAIN_MIN`/`MAX` et LUT 1D rééchantillonnés en 33³) ; la HaldCLUT de niveau L donne une LUT de L² points par côté. En mode Log, la lumière de la scène est d'abord encodée avec la courbe officielle de la caméra (S-Log3, LogC3 à EI 800, V-Log). L'export cuit l'étalonnage : une grille de 33³ couleurs passe par le développement et la finition sur la carte graphique, sans bloom, vignette ni grain, puis revient sous forme de `.cube`.
- **Débruitage** : [FFDNet](https://github.com/cszn/KAIR) (Zhang et al., 2018), les poids couleur de KAIR (licence MIT), réécrits en compute shaders WGSL, sans librairie d'inférence. L'image passe en sRGB, chaque bloc de 2 × 2 pixels devient 12 canaux plus un canal « niveau de bruit », puis 12 convolutions 3 × 3 (96 canaux, ReLU), puis retour en pleine résolution. Les activations sont rangées par groupes de 4 canaux (`vec4f`), et chaque thread calcule un pixel et 16 canaux de sortie avec des produits matrice 4 × 4 par vecteur. Les poids (1,7 Mo) sont convertis du fichier PyTorch en demi-flottants, déjà rangés par blocs 4 × 4. Le traitement se fait par tuiles de 640 px avec une marge de 24 px, pour qu'aucune jointure ne se voie. Validé contre une implémentation numpy de référence : 0,0009 d'écart moyen hors des bords. Une photo de 24 Mpx se débruite en 26 à 28 secondes environ ; la loupe, en une fraction de seconde. La version débruitée remplace la source pour l'aperçu, le bloom et l'export ; « Avant » montre toujours l'original.
- **Balance des blancs** : la température suit le lieu de Planck (approximation de Kim et al.), convertie en multiplicateurs RGB par rapport à 6 500 K, et normalisée pour ne pas changer la luminosité.
- **AgX** : l'approximation polynomiale courante de la transformée de Troy Sobotka.
- **Histogramme** : un compute shader, un thread par pixel de l'aperçu, avec des additions atomiques dans 4 × 256 cases. La lecture se fait en asynchrone, sans bloquer l'affichage.
- **Démo** : l'enseigne est dessinée deux fois en canvas 2D, une fois pour la scène, une fois pour le cœur des tubes. Le cœur est ajouté par-dessus avec un facteur 7, pour obtenir une vraie image HDR.
- Aucune librairie à part LibRaw. Les poids de FFDNet sont dans `models/`, avec leur licence.

## Lancer en local

Le décodage RAW a besoin de `SharedArrayBuffer`, donc d'une page isolée (en-têtes COOP et COEP). Le petit serveur fourni les ajoute :

```bash
python3 day-03-bloom/serve.py
```

puis ouvrir `http://localhost:8766/day-03-bloom/`.

En ligne, GitHub Pages ne permet pas d'ajouter ces en-têtes : un petit service worker (`coi-sw.js`, installé par `coi.js`) les ajoute lui-même à chaque réponse. À la première visite, la page se recharge une fois, puis les RAW s'ouvrent normalement.

## Ce qui viendra

Un débruitage rapide par ondelettes, un réseau plus rapide (demi-flottants, mémoire partagée), la netteté, la clarté, le dehaze, le HSL par teinte, les masques locaux, le recadrage, les corrections d'objectif, les scopes (waveform, vectorscope), et un bloom par FFT avec une ouverture qu'on dessine.

## Le lien avec le mot

*Bloom* : la lumière qui fleurit autour des sources vives. Et une fleur au néon pour l'accueil.
