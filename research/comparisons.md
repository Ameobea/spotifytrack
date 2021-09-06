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

FOV bumped to 92, max connection distance bumped to 3600:

![](https://ameo.link/u/99j.png)

![](https://ameo.link/u/99k.png)

# p/q hyperparam search

## 50k_corpus_p_1_q_16

`const DISTANCE_MULTIPLIER: [f32; 3] = [24000., 24000., 32430.];`

![](https://ameo.link/u/9ah.png)

`const DISTANCE_MULTIPLIER: [f32; 3] = [32000., 32000., 39430.];`

![](https://ameo.link/u/9ai.png)

## 50k_corpus_p_6_q_16

`const DISTANCE_MULTIPLIER: [f32; 3] = [24000., 24000., 32430.];`

![](https://ameo.link/u/9aj.png)

ok something very wrong happened with this one...

![](https://ameo.link/u/9ak.png)

the overall structure is quite poor as well, it's bad.

Interestingly, though, K-Pop has sort of fused with some other Korean pop-esque stuff to form a much bigger structure than I've ever seen before:

![](https://ameo.link/u/9al.png)

Also, hyperpop had very good locality.  So some goods and some bads

## 50k_corpus_p_15_q_2

`const DISTANCE_MULTIPLIER: [f32; 3] = [24000., 24000., 32430.];`

![](https://ameo.link/u/9an.png)

## 50k_corpus_p_2_q_15_pca

`const DISTANCE_MULTIPLIER: [f32; 3] = [24000., 24000., 32430.];`

![](https://ameo.link/u/9ao.png)

### `const DISTANCE_MULTIPLIER: [f32; 3] = [26500., 26400., 31130.];`

![](https://ameo.link/u/9ap.png)

![](https://ameo.link/u/9aq.png)

Overall, this is quite good and there's really a lot of great large-scale structure.  Might be the best we've generated for that. There are very dense regions, but all of them feel like they *should* be really dense.

However, the "backplane" feels extremely dense and spammy.

![](https://ameo.link/u/9ar.png)

Maybe that's how it should be, but I feel that it makes for a bad experience when flying around that region.  Little percievable structure, quite messy.

Also, k-pop is on the opposite side from j-core and vocaloid which I hate to see.  Things seem intensely packed along one dimension.  Going to try to tune down these factors and see if it helps.

## 50k_corpus_p_4_q_14_pca

![](https://ameo.link/u/9as.png)

![](https://ameo.link/u/9at.png)

## 100k_corpus_p_4_q_14_pca

`const DISTANCE_MULTIPLIER: [f32; 3] = [36500., 36400., 41130.];`

![](https://ameo.link/u/9au.png)

It's... really big.  Structure seems to be really good, increasing universe size helps deal with density problems.

![](https://ameo.link/u/9av.png)

![](https://ameo.link/u/9aw.png)

![](https://ameo.link/u/9ax.png)

----

OK - 100k is just too many.  It needs to be toned down.

# 100k_pop_filtered_corpus_p_1_q_16_pca

![](https://ameo.link/u/9b0.png)

![](https://ameo.link/u/9b1.png)

![](https://ameo.link/u/9b2.png)

I was originally really wasn't liking this one, but it's becoming more tolerable as I tweak params.  I still think that the same issues from the previous 100k embeddings are present; the middle part is super spammy with little to no discernable structure.  It seems that there are lots of very long vertical connections being rendered further out from the center despite tweaking the `should_render_connection` to be more strict.

I did reduce the universe size for this one because of an original apparent severe lack of connection density, but that seems to be either 1) a side effect of bad locality/structure in the embedding or 2) a bad `should_render_connection` config.

Going to try other embeddings from the filtered 100k batch that ran overnight...

# 100k_pop_filtered_corpus_p_21_q_6_pca

uhh.... I think we got the p and q backwards...

![](https://ameo.link/u/9b3.png)

LOOK AT ALL THE GLORIOUS STRUCTURE!!

![](https://ameo.link/u/9b4.png)

Strands and tendrils and clusters and masses everywhere.  It's so beautiful.  This makes me feel so so so relieved.

Let's stretch it out even more.

![](https://ameo.link/u/9b5.png)

:weary:

# 100k_pop_filtered_corpus_p_26_q_1_pca

![](https://ameo.link/u/9b6.png)

![](https://ameo.link/u/9b7.png)

![](https://ameo.link/u/9b8.png)

I was originally going to say it's more extreme because that's what I expected, but idk if that's actually true tbh.

You know what?  I think it's too extreme.  It's exactly what we were looking for, but too much.  We're kind of even losing tendrils and strands and just gettings tons of very small, loosely-connected blobs.  I also noticed that PCA explained variance dropped down below 3 for the first dimension.  That seems like a bad sign to me.

Let's try finding a happy medium...

# 100k_pop_filtered_corpus_p_26_q_6_pca

![](https://ameo.link/u/9b9.png)

hmm well originally I really didn't like it but now I'm finding that it's alright.  It's definitely still in the right area.  Honestly, I'm feeling myself worrying less about this stuff at this point.  Since we've started using the proper direction (p being way bigger than q), I find myself less worried about the embedding and wanting to focus back on the other parts of this.  That's so perfect.  Let me try one last thing, though...

# 100k_pop_filtered_corpus_p_16_q_1_pca

Explained variance for dim 1 is still around 2.9 - pretty decent.

![](https://ameo.link/u/9ba.png)

![](https://ameo.link/u/9bb.png)

![](https://ameo.link/u/9bc.png)

![](https://ameo.link/u/9bd.png)

I'll be honest, I think this is a totally acceptable embedding for the project.  I'm not sure if I like it more than the `100k_pop_filtered_corpus_p_21_q_6_pca` we started with, but then again I'm not sure how much of my love for that one was caused by my relief at finding it after struggling with terrible embedddings for so long.

This one has k-pop and vocaloid in pretty close proximity which I love to see.  Tons of structure without being too stringy or sparse:

![](https://ameo.link/u/9be.png)

Flying around, I'm very happy with the placements.  I've encountered no "wtf"s so far although my flight so far has been pretty limited.

We even have a little Vaporwave pocket:

![](https://ameo.link/u/9bf.png)

So beautiful

![](https://ameo.link/u/9bg.png)

We're rolling with this one until one final tuning pass on the embedding.  I'm going to focus on actual features now.  So happy.
