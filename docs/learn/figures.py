"""Figures for 'LunaZen: How the App Works', drawn from the LunaZen app's own engine output
(figdata.json, written by compute.mjs) and its shipped catalogue (web/data/sites.json)."""
import glob, json, os, numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
INK, SUN, EARTH, VERM, SKY, GREY, PANEL = '#101A33', '#E69F00', '#0072B2', '#D55E00', '#2456C6', '#8A93A8', '#F1F3F8'
SUN_L, EARTH_L, ROBUST = '#F6D58C', '#9CC6E4', '#0B7A5A'
HERE = os.path.dirname(os.path.abspath(__file__))
for otf in glob.glob(os.path.join(os.environ.get('INTER_DIR', '/usr/share/fonts/opentype/inter'), 'Inter-*.otf')):
    fm.fontManager.addfont(otf)   # Inter, if it is not installed system-wide: INTER_DIR=/path/to/inter
plt.rcParams.update({
    'font.family': 'Inter', 'font.size': 8.5, 'axes.titlesize': 9, 'axes.titleweight': 'semibold', 'axes.titlelocation': 'left',
    'axes.edgecolor': '#B8C0D3', 'axes.labelcolor': INK, 'xtick.color': '#465071', 'ytick.color': '#465071', 'text.color': INK,
    'axes.spines.top': False, 'axes.spines.right': False, 'axes.linewidth': 0.7, 'xtick.major.width': 0.6, 'ytick.major.width': 0.6,
    'legend.frameon': False, 'legend.fontsize': 7.8, 'figure.dpi': 150, 'savefig.bbox': 'tight', 'savefig.pad_inches': 0.04,
    'pdf.fonttype': 42, 'axes.grid': True, 'grid.color': '#E3E7F0', 'grid.linewidth': 0.6, 'axes.axisbelow': True,
})
D = json.load(open(os.path.join(HERE, 'figdata.json')))
C = json.load(open(os.path.join(HERE, '..', '..', 'web', 'data', 'sites.json')))
W = 6.3  # text width in inches

def save(fig, name): fig.savefig(os.path.join(HERE, 'figures', f'{name}.pdf')); plt.close(fig); print(name)

# 1. Hero: 45 days at Site01-1, the Sun and Earth against the real skyline -------------------------
m = D['march']; sky = np.array(D['skyline']); az = np.arange(len(sky)) * 0.25
fig, ax = plt.subplots(figsize=(W, 2.35))
ax.fill_between(az, -9, sky, color='#C9CFDC', lw=0, zorder=1)
ax.plot(az, sky, color='#6A7392', lw=0.7, zorder=2)
ax.axhline(0, color=INK, lw=0.6, ls=(0, (4, 3)), zorder=3)
ax.text(2, 0.12, 'flat horizon', fontsize=7, color='#465071', va='bottom')
for key_az, key_el, key_f, c_on, c_off, label in [('sunAz', 'sunEl', 'sunF', SUN, SUN_L, 'Sun'), ('earthAz', 'earthEl', 'earthF', EARTH, EARTH_L, 'Earth')]:
    a, e, f = np.array(m[key_az]) % 360, np.array(m[key_el]), np.array(m[key_f])
    ax.scatter(a[f <= 0], e[f <= 0], s=1.2, color=c_off, lw=0, zorder=4, rasterized=True)
    ax.scatter(a[f > 0], e[f > 0], s=1.6, color=c_on, lw=0, zorder=5, rasterized=True)
ax.set_xlim(0, 360); ax.set_ylim(-8.5, 6.5)
ax.set_xticks(range(0, 361, 45)); ax.set_xticklabels(['N', '45°', 'E', '135°', 'S', '225°', 'W', '315°', 'N'])
ax.set_yticks([-8, -4, 0, 4]); ax.set_yticklabels(['−8°', '−4°', '0°', '4°'])
ax.set_ylabel('Elevation'); ax.grid(axis='x', visible=False)
ax.legend(handles=[Line2D([], [], marker='o', ls='', color=SUN, ms=4, label='Sun, visible'), Line2D([], [], marker='o', ls='', color=SUN_L, ms=4, label='Sun, behind terrain'),
                   Line2D([], [], marker='o', ls='', color=EARTH, ms=4, label='Earth, visible'), Line2D([], [], marker='o', ls='', color=EARTH_L, ms=4, label='Earth, behind terrain'),
                   Patch(color='#C9CFDC', label='Terrain (skyline)')], ncol=5, loc='upper center', bbox_to_anchor=(0.5, 1.17), handletextpad=0.2, columnspacing=1.0)
save(fig, 'hero_skyline')

# 2. Two skies: Apollo 11 against Site01-1 over one lunar day ------------------------------------------
a, p = D['apollo'], D['pole30']
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(W, 2.2), gridspec_kw={'width_ratios': [1, 1], 'wspace': 0.28})
for ax, src, title in [(ax1, a, 'Apollo 11, near the equator'), (ax2, p, 'Site01-1, near the south pole')]:
    ax.plot(src['day'], src['sunEl'], color=SUN, lw=1.6, label='Sun')
    ax.plot(src['day'], src['earthEl'], color=EARTH, lw=1.6, label='Earth')
    ax.axhline(0, color=INK, lw=0.6, ls=(0, (4, 3)))
    ax.set_ylim(-12, 92); ax.set_yticks([0, 30, 60, 90]); ax.set_yticklabels(['0°', '30°', '60°', '90°'])
    ax.set_xlim(0, 30); ax.set_xlabel('Days from 1 March 2027'); ax.set_title(title)
ax1.set_ylabel('Elevation above a flat horizon')
ax2.annotate('Both stay within a few\ndegrees of the horizon', xy=(14, 3), xytext=(9, 45), fontsize=7.5, color=INK,
             arrowprops=dict(arrowstyle='-', color='#6A7392', lw=0.7))
ax1.legend(loc='upper right', ncol=2)
save(fig, 'two_skies')

# 3. The dark stretches of 2027 at Site01-1 against two published tolerances ------------------------------
dark = D['dark']; day = [s * 0.25 / 24 for s, h in dark]; hours = [h for s, h in dark]
fig, ax = plt.subplots(figsize=(W, 2.1))
cols = [VERM if h > 50 else (SUN if h > 5 else '#8A93A8') for h in hours]
ax.bar(day, hours, width=2.2, color=cols, lw=0)
for y, lab in [(50, '50 h darkness limit (VIPER design figure)'), (5, '5 h (Blue Ghost 1 survived)')]:
    ax.axhline(y, color=INK, lw=0.8, ls=(0, (4, 3))); ax.text(366, y + 2.5, lab, ha='right', va='bottom', fontsize=7.2, color=INK)
k = int(np.argmax(hours)); ax.annotate(f'The longest: {hours[k]:g} h (5 d 18 h)', xy=(day[k] + 1.5, hours[k] - 3), xytext=(day[k] + 95, hours[k] - 10), fontsize=7.5,
                                         arrowprops=dict(arrowstyle='-', color='#6A7392', lw=0.7), ha='left', va='center')
ax.set_xlim(0, 366); ax.set_ylim(0, 150)
ax.set_xticks([0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]); ax.set_xticklabels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
ax.set_ylabel('Hours in darkness'); ax.grid(axis='x', visible=False)
save(fig, 'dark_stretches')

# 4. Where and how high: the ring of 100 m and the mast -------------------------------------------------------
sp = {s['id']: s for s in C['spots']}; s = sp['Site01-1']
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(W, 2.45), gridspec_kw={'width_ratios': [1, 1.25], 'wspace': 0.35})
pts = [(0.0, 0.0, s['years']['2027']['2']['sunlitFraction'])] + [(r['offsetM'][0], r['offsetM'][1], r['years']['2027']['sunlitFraction']) for r in s['ring']]
cmap = matplotlib.colors.LinearSegmentedColormap.from_list('sun', ['#3B4566', '#8A6A2E', SUN, '#FFD777'])
for rr in (50, 100): ax1.add_patch(plt.Circle((0, 0), rr, fill=False, ls=(0, (2, 3)), color='#B8C0D3', lw=0.7))
for x, y, f in pts:
    ax1.scatter([x], [y], s=150 if (x, y) == (0, 0) else 95, color=cmap((f - 0.3) / 0.65), edgecolor='white', lw=0.8, zorder=3)
    ax1.text(x, y - (17 if (x, y) != (0, 0) else 19), f'{f*100:.0f}%', ha='center', va='top', fontsize=6.6, color=INK, zorder=4)
ax1.set_xlim(-128, 128); ax1.set_ylim(-128, 128); ax1.set_aspect('equal'); ax1.axis('off')
ax1.set_title('Sunlight in 2027 within 100 m of Site01-1')
ax1.text(0, -126, 'rings at 50 m and 100 m; 2 m mast', ha='center', fontsize=6.8, color='#465071')
masts = [1, 2, 5, 10]; sun = [s['years']['2027'][str(k)]['sunlitFraction'] * 100 for k in masts]; night = [s['years']['2027'][str(k)]['longestDarkHours'] for k in masts]
xs = np.arange(4); ax2.bar(xs, night, width=0.55, color=[VERM if n > 50 else ROBUST for n in night], lw=0)
for x, n, sn in zip(xs, night, sun): ax2.text(x, n + 5, f'{n:g} h\n{sn:.1f}% sunlit', ha='center', va='bottom', fontsize=6.8)
ax2.axhline(50, color=INK, lw=0.8, ls=(0, (4, 3))); ax2.text(-0.45, 53, '50 h limit', ha='left', va='bottom', fontsize=6.8)
ax2.set_xticks(xs); ax2.set_xticklabels([f'{k} m' for k in masts]); ax2.set_ylim(0, 265); ax2.set_xlim(-0.5, 3.5)
ax2.set_xlabel('Mast height'); ax2.set_ylabel('Longest night (h)'); ax2.set_title('Longest night at Site01-1 by mast height'); ax2.grid(axis='x', visible=False)
save(fig, 'ring_and_mast')

# 5. All 67 spots: sunlight against the longest night ---------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(W, 2.6))
xs, ys, ys10 = [], [], []
for x in C['spots']:
    y = x['years']['2027']; xs.append(y['2']['sunlitFraction'] * 100); ys.append(y['2']['longestDarkHours']); ys10.append(y['10']['longestDarkHours'])
ax.axhspan(0, 50, color='#E2F3EC', lw=0, zorder=0); ax.text(46, 38, 'Within the 50 h limit: no spot', fontsize=7.5, color=ROBUST, va='center', weight='semibold')
ax.scatter(xs, ys10, s=14, facecolor='none', edgecolor='#8A93A8', lw=0.7, label='10 m mast', zorder=2)
ax.scatter(xs, ys, s=16, color=INK, lw=0, label='2 m mast', zorder=3)
ax.axhline(50, color=INK, lw=0.8, ls=(0, (4, 3)))
for sid, tx, ty, lab in [('Site01-1', 93.5, 420, 'Site01-1: 89.7% sunlit,\nlongest night 138 h'), ('Site04-1', 74, 62, 'Site04-1: 82 h, the shortest')]:
    k = [x['id'] for x in C['spots']].index(sid)
    ax.annotate(lab, xy=(xs[k], ys[k]), xytext=(tx, ty), fontsize=7.2, ha='right' if sid == 'Site01-1' else 'right', va='center',
                arrowprops=dict(arrowstyle='-', color='#6A7392', lw=0.7, shrinkA=2, shrinkB=3))
    ax.scatter([xs[k]], [ys[k]], s=34, facecolor='none', edgecolor=VERM, lw=1.1, zorder=4)
ax.set_yscale('log'); ax.set_ylim(30, 1200); ax.set_yticks([50, 100, 200, 500, 1000]); ax.set_yticklabels(['50', '100', '200', '500', '1000'])
ax.set_xlim(45, 95); ax.set_xlabel('Share of 2027 with the Sun up (%)'); ax.set_ylabel('Longest night (h, log scale)')
ax.legend(loc='lower right', ncol=2, bbox_to_anchor=(1, 0.0)); ax.set_title('All 67 candidate spots in 2027')
save(fig, 'all_spots')

# 6. Forty-five days as the app's three answers -----------------------------------------------------------------------------
dd = np.array(m['day']); sf, ef, dsn = np.array(m['sunF']), np.array(m['earthF']), np.array(m['dsn'])
fig, axs = plt.subplots(3, 1, figsize=(W, 1.9), sharex=True, gridspec_kw={'hspace': 0.35})
for ax, y, col, lab in [(axs[0], sf, SUN, 'Sun visible'), (axs[1], ef, EARTH, 'Earth visible'), (axs[2], ((ef > 0) & (dsn == 1)).astype(float), ROBUST, 'DSN in view')]:
    ax.fill_between(dd, 0, y, color=col, lw=0, step='mid'); ax.set_ylim(0, 1.05); ax.set_yticks([]); ax.grid(False)
    ax.spines['left'].set_visible(False); ax.text(-0.012, 0.5, lab, ha='right', va='center', fontsize=7.8, transform=ax.get_yaxis_transform())
axs[0].text(45, 1.12, 'height = share of the disk above the skyline', ha='right', fontsize=6.8, color='#465071')
axs[2].set_xlim(0, 45); axs[2].set_xticks([0, 7, 14, 21, 28, 35, 42]); axs[2].set_xticklabels(['1 Mar', '8 Mar', '15 Mar', '22 Mar', '29 Mar', '5 Apr', '12 Apr'])
save(fig, 'three_answers')
