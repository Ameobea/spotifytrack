# pca.w2v

![](https://ameo.link/u/999.png)

![](https://ameo.link/u/99a.png)

![](https://ameo.link/u/99b.png)

# 50k_corpus_4_dims_new_settings_smaller_window_pca

`const DISTANCE_MULTIPLIER: f32 = 15430.;`

Suffers from bad transitions, likely due to the smaller window size.  There is less context and so oldies guy group was like 5k distance away from modern rap.

![](https://ameo.link/u/99c.png)

![](https://ameo.link/u/99d.png)

## const DISTANCE_MULTIPLIER: [f32; 3] = [15430., 30430., 15430.];

![](https://ameo.link/u/99e.png)

## const DISTANCE_MULTIPLIER: [f32; 3] = [15430., 15430., 30430.];

![](https://ameo.link/u/99f.png)

## const DISTANCE_MULTIPLIER: [f32; 3] = [18430., 18430., 22430.];

![](https://ameo.link/u/99g.png)

![](https://ameo.link/u/99h.png)

# 50k_corpus_4_dims_new_settings_pca

Still using `const DISTANCE_MULTIPLIER: [f32; 3] = [18430., 18430., 22430]` from above which helps to make it less flat.  That makes sense since each dimension explains less variance than the last due to the way that PCA works.

Very well-defined kpop which I love to see

![](https://ameo.link/u/99i.png)

FOV bumpted to 92, max connection distance bumped to 3600:

![](https://ameo.link/u/99j.png)

![](https://ameo.link/u/99k.png)
