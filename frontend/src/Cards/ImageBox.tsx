import React from 'react';
import { Link } from 'react-router-dom';

import { getProxiedImageURL } from 'src/util/index';
import './Cards.scss';

interface ImageBoxProps {
  imageSrc: string | null | undefined;
  imgAlt: string;
  linkTo?: string;
  mobile: boolean;
}

const ImageBox: React.FC<ImageBoxProps> = ({ imageSrc, imgAlt, children, linkTo, mobile }) => {
  const image = (
    <img
      alt={imgAlt}
      src={imageSrc ? getProxiedImageURL(mobile ? 90 : 160, imageSrc) : ''}
      className="image-container"
    />
  );

  return (
    <div className="image-box">
      <div className="track">
        {linkTo ? <Link to={linkTo}>{image}</Link> : image}

        <div className="image-box-content">{children}</div>
      </div>
    </div>
  );
};

export default ImageBox;
