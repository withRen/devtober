# 02 · Loop

Un générateur de fonds d'écran : des milliers de particules qui tournent en boucle. Tu choisis la forme de la boucle (ou tu la dessines à la main), le rendu (points, ASCII ou vecteurs), le halo, les couleurs, puis tu exportes à la résolution de ton écran.

**[Ouvrir le générateur](https://withren.github.io/devtober/day-02-loop/)**

## Ce qu'on peut faire

- **10 préréglages** avec miniatures : Galaxie, Orbite (sphère granuleuse, anneaux en orbite, aberration chromatique), Sphère de chiffres, Fleur néon, Code, Infini, Atome, Respiration et Interactif (animés par des nœuds), Papier.
- **Éditeur de nœuds** (bouton « Nœuds » ou `N`), à la Blender ou DaVinci Fusion : le pipeline Forme, Boucles, Mouvement, Rendu, Effets, Couleurs, Cadrage, Sortie, avec chaque paramètre en entrée. On y branche des nœuds **Temps, Oscillateur, Bruit, Souris, Valeur, Math** et **Plage**, qui s'enchaînent entre eux. Glisser une sortie vers un paramètre pour l'animer, `Maj+A` ou clic droit pour ajouter, `Suppr` pour effacer, molette pour zoomer. Les champs se règlent en glissant, comme dans Blender, ou au clavier en cliquant.
- **9 formes** : Galaxie (bras spiraux), Sphère (en 3D, avec perspective), Cercle, Infini, Fleur, Lissajous, Cœur, Étoile, et **Dessin libre** : tu traces une boucle à la souris ou au doigt, les particules la suivent.
- **Boucles** : jusqu'à 16 boucles imbriquées, décalées et tournant dans des sens alternés, de 5 000 à 200 000 particules, regroupées en filaments, plus de la poussière d'étoiles.
- **Mouvement** : vitesse le long de la boucle, rotation, turbulence, traînées.
- **4 rendus** : **Particules**, **ASCII** (5 jeux de caractères), **Vecteurs** (lignes tracées) et **Glyphes** (un caractère par particule, plus petit et plus sombre quand il est loin).
- **Anneaux en orbite** : jusqu'à 5 ellipses inclinées autour de la forme.
- **Effets** : halo, aberration chromatique, grain.
- **7 palettes** et trois couleurs libres (fond, moyenne, vive). Les fonds clairs fonctionnent aussi.
- **Cadrage** : zoom, position, angle.
- **Export** : PNG à la résolution choisie (ton écran, 4K, 1440p, 1080p, ultra large, iPhone, Android, carré) et **SVG** vectoriel avec halo.
- **Aléatoire** (`R`), pause (`Espace`), masquer les réglages (`H`), et un lien de partage qui contient tous les réglages.

## Comment c'est codé

- **Une position par formule, pas par simulation** : chaque particule a trois nombres fixes (sa boucle, sa place le long de la boucle, son décalage dans le filament), et sa position est une fonction pure du temps. L'aperçu et l'export donnent donc exactement la même image, à n'importe quelle résolution.
- **Formes à vitesse constante** : chaque forme est échantillonnée 4 096 fois puis rééchantillonnée à longueur d'arc constante, pour que les particules se répartissent régulièrement, même sur un dessin à main levée.
- **Densité, puis couleur** : les particules s'additionnent dans un tampon de flottants (dépôt bilinéaire, donc sans crénelage), converti en couleurs par une table de 1 024 teintes. Le cœur devient lumineux tout seul, là où les particules se superposent.
- **Traînées** : en direct, le tampon s'estompe à chaque image. À l'export, on additionne les 30 à 45 dernières positions avec le même poids, pour obtenir la même traînée.
- **Turbulence** : un bruit de valeur sur une grille de 256 × 256 qui se répète, deux octaves.
- **ASCII** : la densité moyenne de chaque cellule choisit un caractère dans un atlas pré-rendu, découpé en 24 niveaux de couleur.
- **Halo** : l'image réduite deux fois (donc floutée), puis ajoutée par-dessus.
- **Aberration chromatique** : l'image est séparée en trois calques rouge, vert et bleu par composition de canvas, le rouge légèrement agrandi, le bleu légèrement réduit, puis ils sont additionnés. Le grain est un motif de bruit en mode « overlay ». Les deux restent sur la carte graphique.
- **Sphère et orbites** : chaque angle vaut « angle propre + rotation commune ». Le cosinus et le sinus de l'angle propre sont précalculés, puis tournés par une multiplication à chaque image : aucune fonction trigonométrique par particule. Le préréglage Orbite (171 000 particules) est passé de 56 à 21 ms par image.
- Aucune librairie.

Performances mesurées sur un M1 Pro, aperçu de 1,6 mégapixel : environ 10 ms par image à 70 000 particules, 3 ms en vecteurs. L'export PNG en 4K prend moins d'une seconde.

- **Nœuds** : le graphe est évalué à chaque image, en partant des paramètres branchés et en remontant les fils (avec mémoïsation, et refus des connexions qui créeraient une boucle). Ses valeurs remplacent les réglages le temps du rendu, puis les réglages d'origine sont restaurés. Les paramètres qui reconstruisent les particules (nombre, filaments, dispersion…) restent réglables mais pas animables, signalés par un cadenas. L'export et le lien de partage incluent le graphe.

## Le lien avec le mot

*Loop* : chaque particule fait le tour de sa boucle et revient, indéfiniment.
