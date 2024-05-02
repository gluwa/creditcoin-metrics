FROM node:18

WORKDIR /usr/app
COPY package*.json ./

RUN npm install
RUN npm install -g forever

COPY . .

RUN npm run build

EXPOSE 8080

CMD [ "npm", "run", "start" ]
