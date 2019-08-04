import React from 'react';

const GenreStats: React.FC<{ username: string; genre: string }> = ({ username, genre }) => (
  <div>
    <h1>{username}</h1>
    {genre}
  </div>
);

export default GenreStats;
