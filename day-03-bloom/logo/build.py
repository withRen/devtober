"""Logo de Bloom : un disque de lumière, un anneau vide, une étoile de diffraction.
Génère les variantes du logo à partir de la même géométrie (python3 build.py)."""
INK = '#0e0e10'
SPIKES = [(0, 418, 132), (90, 300, 116), (45, 196, 78), (135, 196, 78)]   # angle, longueur, demi-largeur à la base
ORB, GAP, TILT, PINCH = 120, 30, -12, 0.36


def spike(angle, length, w):
    # Un rayon effilé aux flancs incurvés, des deux côtés du centre.
    a, p = length * 0.24, w * PINCH
    d = (f"M {-length},0 Q {-a:.1f},{-p:.1f} 0,{-w} Q {a:.1f},{-p:.1f} {length},0 "
         f"Q {a:.1f},{p:.1f} 0,{w} Q {-a:.1f},{p:.1f} {-length},0 Z")
    return f'<path d="{d}" transform="rotate({angle})"/>'


def glyph(fill, uid):
    rays = ''.join(spike(*s) for s in SPIKES)
    return (f'<defs><mask id="{uid}"><rect x="-600" y="-600" width="1200" height="1200" fill="#fff"/>'
            f'<circle r="{ORB + GAP}" fill="#000"/></mask></defs>'
            f'<g fill="{fill}" transform="rotate({TILT})"><g mask="url(#{uid})">{rays}</g><circle r="{ORB}"/></g>')


def icon(dark=False):
    top, bottom, ink = ('#2a2a2e', '#121214', '#f4f4f5') if dark else ('#ffffff', '#ebebed', INK)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <title>Bloom</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000" flood-opacity=".22"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)" filter="url(#sh)"/>
  <g transform="translate(512 512) scale(0.9)">{glyph(ink, 'm')}</g>
</svg>
'''


# Le symbole seul, en currentColor : il prend la couleur du texte qui l'entoure.
mark = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-440 -440 880 880">
  <title>Bloom</title>
  {glyph('currentColor', 'bm')}
</svg>
'''

# Favicon : le symbole sur le carré noir, lisible à 16 px (seules les quatre grandes branches).
fav = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#141416"/>
  <g transform="translate(32 32) scale(0.064)">
    <defs><mask id="f"><rect x="-600" y="-600" width="1200" height="1200" fill="#fff"/><circle r="{ORB + GAP + 12}" fill="#000"/></mask></defs>
    <g fill="#f4f4f5" transform="rotate({TILT})"><g mask="url(#f)">{spike(0, 418, 150)}{spike(90, 300, 130)}</g><circle r="{ORB + 12}"/></g>
  </g>
</svg>
'''

# Logo complet : le symbole et le nom.
lockup = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 400">
  <title>Bloom</title>
  <g transform="translate(200 200) scale(0.42)">{glyph(INK, 'lm')}</g>
  <text x="440" y="246" font-family="Geist, 'SF Pro Display', -apple-system, 'Helvetica Neue', Arial, sans-serif" font-size="148" font-weight="600" letter-spacing="-5" fill="{INK}">Bloom</text>
</svg>
'''

for name, svg in [('bloom-icon.svg', icon()), ('bloom-icon-dark.svg', icon(True)), ('bloom-mark.svg', mark),
                  ('favicon.svg', fav), ('bloom-lockup.svg', lockup)]:
    open(name, 'w').write(svg)
