## Patching Webcola

To use the accelerated webcola-wasm, use this hack:

```
: 1727210779:0;rm -rf ~/spotifytrack/frontend/node_modules/webcola/
: 1727210798:0;ln -s /home/casey/webcola-wasm /home/casey/spotifytrack/frontend/node_modules/webcola
: 1727210808:0;cd ~/spotifytrack/frontend
: 1727210809:0;just build
```
