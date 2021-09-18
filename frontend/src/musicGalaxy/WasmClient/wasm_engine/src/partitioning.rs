//! Divides the universe up into uniform cubic partitions.  Each artist exists in exactly one
//! partition.  This serves as a broad phase for distance computations so that we don't need to
//! calculate the distance between the user and all artists when performing dynamic changes.

use crate::{distance, ArtistState};
use bitflags::bitflags;

pub const NUM_PARTITIONS_PER_DIMENSION: usize = 64;

bitflags! {
    pub struct InRange: u8 {
        const IN_RANGE_OF_ENVELOPE = 0b0000_0001;
        const IN_RANGE_OF_SPHERE = 0b0000_0010;
    }
}

pub struct Partition {
    pub center: [f32; 3],
    pub contained_artist_indices: Vec<usize>,
}

pub type Partitions = [[[Partition; NUM_PARTITIONS_PER_DIMENSION]; NUM_PARTITIONS_PER_DIMENSION];
    NUM_PARTITIONS_PER_DIMENSION];

pub struct PartitionedUniverse {
    pub partitions: Box<Partitions>,
    pub mins: [f32; 3],
    pub maxs: [f32; 3],
    pub partition_width: f32,
    pub max_distance_to_midpoint: f32,
}

pub struct IteredPartition<'a, const RADIUS_COUNT: usize> {
    pub center: &'a [f32; 3],
    pub artist_indices: &'a [usize],
    pub in_range: [InRange; RADIUS_COUNT],
}

impl PartitionedUniverse {
    pub fn get_partition_index(&self, pos: &[f32; 3]) -> [usize; 3] {
        let x = ((pos[0] - self.mins[0]) / self.partition_width)
            .trunc()
            .max(0.)
            .min(NUM_PARTITIONS_PER_DIMENSION as f32 - 1.) as usize;
        let y = ((pos[1] - self.mins[1]) / self.partition_width)
            .trunc()
            .max(0.)
            .min(NUM_PARTITIONS_PER_DIMENSION as f32 - 1.) as usize;
        let z = ((pos[2] - self.mins[2]) / self.partition_width)
            .trunc()
            .max(0.)
            .min(NUM_PARTITIONS_PER_DIMENSION as f32 - 1.) as usize;
        [x, y, z]
    }

    /// Finds all partitions that are within `delta_distance` of a sphere of radius `radius` with a
    /// center of `center`.  This is useful for finding all partitions that may have come into or
    /// gone out of a certain range of the user as a result of movement.
    pub fn iter_approx_near_spherical_envelope<'a, const RADIUS_COUNT: usize>(
        &'a self,
        delta_distance: f32,
        center: [f32; 3],
        radiuses: [f32; RADIUS_COUNT],
    ) -> impl Iterator<Item = IteredPartition<'a, RADIUS_COUNT>> {
        // There's probably a more efficient way to do this that handles not iterating over all the
        // inner partitions that certainly haven't gone out of range.

        let mut max_radius = radiuses[0];
        for radius in &radiuses[1..] {
            if *radius > max_radius {
                max_radius = *radius;
            }
        }

        // When searching in a radius of a given position, we need to incrase the search radius to
        // ensure that the center of the partition that contains potentially in-range target artists
        // is included.
        //
        // Add in the distance between the source position and the center of the partition that
        // contains it to start.  Then add in the max distance between a partition and its midpoint.
        let [src_x, src_y, src_z] = self.get_partition_index(&center);
        let src_partition = &self.partitions[src_x][src_y][src_z];

        let distance_to_center_of_src_partition = distance(&src_partition.center, &center);

        let search_safety_margin =
            distance_to_center_of_src_partition + self.max_distance_to_midpoint + delta_distance;

        let min_x = src_partition.center[0] - search_safety_margin;
        let min_y = src_partition.center[1] - search_safety_margin;
        let min_z = src_partition.center[2] - search_safety_margin;
        let [min_x_partition_ix, min_y_partition_ix, min_z_partition_ix] =
            self.get_partition_index(&[min_x, min_y, min_z]);

        let max_x = src_partition.center[0] + search_safety_margin;
        let max_y = src_partition.center[1] + search_safety_margin;
        let max_z = src_partition.center[2] + search_safety_margin;
        let [max_x_partition_ix, max_y_partition_ix, max_z_partition_ix] =
            self.get_partition_index(&[max_x, max_y, max_z]);

        info!("src_partition_ix={:?}", [src_x, src_y, src_z]);
        info!("src_partition.center={:?}", src_partition.center);
        info!(
            "cur_pos={:?}, min partition ixs={:?}, max partition ixs={:?}",
            center,
            [min_x_partition_ix, min_y_partition_ix, min_z_partition_ix],
            [max_x_partition_ix, max_y_partition_ix, max_z_partition_ix]
        );

        (min_x_partition_ix..max_x_partition_ix).flat_map(move |x| {
            (min_y_partition_ix..max_y_partition_ix).flat_map(move |y| {
                (min_z_partition_ix..max_z_partition_ix).filter_map(move |z| {
                    let partition = &self.partitions[x][y][z];
                    let distance_to_center = distance(&partition.center, &center);

                    // We want to include partitions that are within `search_safety_margin` of any
                    // of the radiuses.
                    let mut in_range: [InRange; RADIUS_COUNT] = [InRange::empty(); RADIUS_COUNT];

                    let mut any_in_range_of_envelope = false;
                    for radius_ix in 0..RADIUS_COUNT {
                        let radius = radiuses[radius_ix];
                        if (distance_to_center - radius).abs() <= search_safety_margin * 4. {
                            in_range[radius_ix].set(InRange::IN_RANGE_OF_ENVELOPE, true);
                            any_in_range_of_envelope = true;
                        }

                        if distance_to_center <= radius {
                            in_range[radius_ix].set(InRange::IN_RANGE_OF_SPHERE, true);
                        }
                    }
                    if !any_in_range_of_envelope {
                        return None;
                    }

                    Some(IteredPartition {
                        center: &partition.center,
                        artist_indices: &partition.contained_artist_indices,
                        in_range,
                    })
                })
            })
        })
    }
}

pub fn create_partitions(
    mins: [f32; 3],
    maxs: [f32; 3],
    all_artists: &[(u32, ArtistState)],
) -> PartitionedUniverse {
    let mut partitions: Box<Partitions> = unsafe { Box::new_uninit().assume_init() };

    let partition_width = (maxs[0] - mins[0])
        .max(maxs[1] - mins[1])
        .max(maxs[2] - mins[2])
        / NUM_PARTITIONS_PER_DIMENSION as f32;
    info!(
        "mins={:?}, maxs={:?}, partition_width={:?}",
        mins, maxs, partition_width
    );

    // Initialize empty partitions
    for x in 0..NUM_PARTITIONS_PER_DIMENSION {
        for y in 0..NUM_PARTITIONS_PER_DIMENSION {
            for z in 0..NUM_PARTITIONS_PER_DIMENSION {
                let min = [
                    mins[0] + partition_width * x as f32,
                    mins[1] + partition_width * y as f32,
                    mins[2] + partition_width * z as f32,
                ];
                let max = [
                    mins[0] + partition_width * (x + 1) as f32,
                    mins[1] + partition_width * (y + 1) as f32,
                    mins[2] + partition_width * (z + 1) as f32,
                ];
                let center = [
                    min[0] + (max[0] - min[0]) / 2.0 as f32,
                    min[1] + (max[1] - min[1]) / 2.0 as f32,
                    min[2] + (max[2] - min[2]) / 2.0 as f32,
                ];

                let ptr = (&mut partitions[x][y][z]) as *mut _;
                unsafe {
                    std::ptr::write(ptr, Partition {
                        center,
                        contained_artist_indices: Vec::new(),
                    })
                };
            }
        }
    }

    let max_distance_to_midpoint = distance(
        &[
            partition_width / 2.0,
            partition_width / 2.0,
            partition_width / 2.0,
        ],
        &[0., 0., 0.],
    );

    let mut universe = PartitionedUniverse {
        partitions,
        mins,
        maxs,
        partition_width,
        max_distance_to_midpoint,
    };

    // Fill partitions with artist indices
    for (i, (_id, artist)) in all_artists.iter().enumerate() {
        let [x, y, z] = universe.get_partition_index(&artist.position);
        let partition = &mut universe.partitions[x][y][z];
        partition.contained_artist_indices.push(i);
    }

    universe
}
