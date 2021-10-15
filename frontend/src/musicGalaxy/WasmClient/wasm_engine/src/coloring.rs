use lazy_static::lazy_static;
use noise::NoiseFn;
use palette::{
    rgb::{channels::Argb, Rgb, RgbStandard},
    Gradient, LinSrgb,
};

use super::ArtistMapCtx;

const NOISE_POS_DIVISOR: f64 = 84_000.;
const BASE_ARTIST_COLOR: u32 = 0x1586a6;
const BASE_CONNECTION_COLOR: u32 = 0x0072dd;
pub const COLOR_NOISE_SEED: u32 = 1238432289;

fn expand_range(byte: u8) -> f64 { byte as f64 / 255. }

fn map_rgb_to_linsrgb<T: RgbStandard>(rgb: &Rgb<T, u8>) -> LinSrgb<f64> {
    Rgb::new(
        expand_range(rgb.red),
        expand_range(rgb.green),
        expand_range(rgb.blue),
    )
}

fn map_step<T: RgbStandard>((interval, rgb): (f64, Rgb<T, u8>)) -> (f64, LinSrgb<f64>) {
    (interval * 2. - 1., map_rgb_to_linsrgb(&rgb))
}

lazy_static! {
    static ref ARTIST_COLOR_GRADIENT: Gradient<LinSrgb<f64>> = {
        let steps: Vec<(f64, LinSrgb<f64>)> = [
            (0., LinSrgb::from_u32::<Argb>(BASE_ARTIST_COLOR)),
            (0.05, LinSrgb::from_u32::<Argb>(0x42e7ed)),
            (0.2, LinSrgb::from_u32::<Argb>(0x42e7ed)),
            (0.25, LinSrgb::from_u32::<Argb>(BASE_ARTIST_COLOR)),
            (0.7, LinSrgb::from_u32::<Argb>(BASE_ARTIST_COLOR)),
            (0.88, LinSrgb::from_u32::<Argb>(0x0082cf)),
            (1., LinSrgb::from_u32::<Argb>(BASE_ARTIST_COLOR)),
        ]
        .into_iter()
        .map(map_step)
        .collect();
        Gradient::with_domain(steps)
    };
    static ref CONNECTION_COLOR_GRADIENT: Gradient<LinSrgb<f64>> = {
        let steps: Vec<(f64, LinSrgb<f64>)> = [
            (0., LinSrgb::from_u32::<Argb>(BASE_CONNECTION_COLOR)),
            (0.05, LinSrgb::from_u32::<Argb>(0x1ac7c1)),
            (0.15, LinSrgb::from_u32::<Argb>(0x14afba)),
            (0.18, LinSrgb::from_u32::<Argb>(0x5f52bf)),
            (0.3, LinSrgb::from_u32::<Argb>(0x1bb7e9)),
            (0.55, LinSrgb::from_u32::<Argb>(0x1266b0)),
            (0.76, LinSrgb::from_u32::<Argb>(0x2498c9)),
            (0.78, LinSrgb::from_u32::<Argb>(0x19bfaf)),
            (0.85, LinSrgb::from_u32::<Argb>(0x19bfaf)),
            (0.95, LinSrgb::from_u32::<Argb>(0x343ad9)),
            (1., LinSrgb::from_u32::<Argb>(BASE_CONNECTION_COLOR)),
        ]
        .into_iter()
        .map(map_step)
        .collect();
        Gradient::with_domain(steps)
    };
}

impl ArtistMapCtx {
    #[inline(never)]
    pub fn populate_connection_colors_buffer(&mut self) {
        self.connection_colors_buffer = Vec::with_capacity(self.connections_buffer.len() * 2);

        for pos in &self.connections_buffer {
            let midpoint = [
                (pos[0][0] + pos[1][0]) / 2.,
                (pos[0][1] + pos[1][1]) / 2.,
                (pos[0][2] + pos[1][2]) / 2.,
            ];

            let val = self.color_noise.get([
                midpoint[0] as f64 / NOISE_POS_DIVISOR,
                midpoint[1] as f64 / NOISE_POS_DIVISOR,
                midpoint[2] as f64 / NOISE_POS_DIVISOR,
            ]);
            let color = CONNECTION_COLOR_GRADIENT.get(val);
            let (r, g, b) = color.into_components();
            self.connection_colors_buffer
                .push([r as f32, g as f32, b as f32]);

            self.connection_colors_buffer
                .push([r as f32, g as f32, b as f32]);
        }
    }

    #[inline(never)]
    pub fn populate_artist_color_buffer(&mut self) {
        self.artist_colors_buffer = Vec::with_capacity(self.all_artists.len());

        for (artist_id, artist) in &self.all_artists {
            let val = self.color_noise.get([
                artist.position[0] as f64 / NOISE_POS_DIVISOR,
                artist.position[1] as f64 / NOISE_POS_DIVISOR,
                artist.position[2] as f64 / NOISE_POS_DIVISOR,
            ]);
            let color = ARTIST_COLOR_GRADIENT.get(val);
            let (r, g, b) = color.into_components();
            self.artist_colors_buffer
                .push((unsafe { std::mem::transmute(*artist_id) }, [
                    r as f32, g as f32, b as f32,
                ]));
        }
    }
}
