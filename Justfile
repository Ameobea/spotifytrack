build-and-deploy:
  # cd frontend && yarn build
  # cd -

  # cd backend && just docker-build
  # cd -

  # docker tag ameo/spotifytrack-backend:latest gcr.io/free-tier-164405/spotifytrack-backend:latest
  # docker push gcr.io/free-tier-164405/spotifytrack-backend:latest

  gcloud config set run/region us-west1
  gcloud beta run deploy spotifytrack-backend \
    --platform managed \
    --set-env-vars="ROCKET_DATABASES=$ROCKET_DATABASES,\
      SPOTIFY_CLIENT_ID=$SPOTIFY_CLIENT_ID,\
      SPOTIFY_CLIENT_SECRET=$SPOTIFY_CLIENT_SECRET,\
      API_SERVER_URL=https://spotifytrack.net/api,\
      WEBSITE_URL=https://spotifytrack.net,\
      REDIS_URL=$REDIS_URL,\
      ADMIN_API_TOKEN=$ADMIN_API_TOKEN"\
    --image gcr.io/free-tier-164405/spotifytrack-backend:latest

  rsync -Prv -e "ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -F /dev/null" ./frontend/dist/* root@spotifytrack.net:/var/www/spotifytrack
