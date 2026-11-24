"""Read the PSD written by tests/psd.js with psd-tools and compare every layer pixel (pip install psd-tools)."""
import json, sys
import numpy as np
from psd_tools import PSDImage
path = sys.argv[1]
meta = json.load(open(path + '.json')); w, h = meta['w'], meta['h']
raw = np.fromfile(path + '.raw', dtype=np.uint8).reshape(2, h, w, 4)
psd = PSDImage.open(path)
assert (psd.width, psd.height) == (w, h), (psd.width, psd.height)
names = [l.name for l in psd]
print('layers:', names, 'visible:', [l.visible for l in psd], 'opacity:', [l.opacity for l in psd])
assert names == ['Paper', 'Stacked result', 'Drawing · µm'], names
assert [l.visible for l in psd] == [False, True, True]
assert psd[1].opacity == 153
for k, layer in ((0, psd[1]), (1, psd[2])):
    a = layer.numpy(channel=None)  # float 0..1, RGBA
    got = np.round(a * 255).astype(int)
    exp = raw[k].astype(int)
    assert got.shape == exp.shape, (got.shape, exp.shape)
    err = np.abs(got - exp)
    if k == 1: err[..., :3] *= (exp[..., 3:] > 0)  # colour under zero alpha is irrelevant
    print(f'{layer.name}: max |error| = {err.max()}')
    assert err.max() == 0
comp = np.round(psd.numpy() * 255).astype(int)[..., :3]
print('composite max |error| =', np.abs(comp - raw[0][..., :3]).max())
print('OK')
