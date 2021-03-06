FROM phusion/baseimage:0.9.22

# Install.
RUN \
    apt-get update && \
    apt-get install sudo && \
    sed -i 's/# \(.*multiverse$\)/\1/g' /etc/apt/sources.list && \
    apt-get update && \
    apt-get -y upgrade && \
    apt-get install -y build-essential && \
    apt-get install -y software-properties-common && \
    apt-get install -y byobu curl git htop man unzip vim wget && \
    rm -rf /var/lib/apt/lists/* && \
    curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash - && \
    sudo apt-get install -y nodejs
#    && \
#    sudo apt-get install -y libnss3 && \
#    sudo apt-get install -y libgtk2.0-0 libgdk-pixbuf2.0-0 libfontconfig1 libxrender1 libx11-6 libglib2.0-0 libxft2 libfreetype6 libc6 zlib1g libpng12-0 libstdc++6-4.8-dbg-arm64-cross libgcc1

COPY ./node_modules /root/export-app/node_modules
COPY ./dist /root/export-app/dist
ADD ./package.json /root/export-app/package.json

# Install Original Chrome
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
RUN dpkg -i google-chrome-stable_current_amd64.deb; apt-get -fy install

# Upload and unzip Patched Chrome(Docker + Amazon ECS specific. Comment next 4 lines if you don't have shm issue)
RUN wget https://s3.amazonaws.com/cb-browser-buids/noshmchromium.zip
RUN mkdir /usr/customchromium/
RUN mv noshmchromium.zip /usr/customchromium/
RUN cd /usr/customchromium/ && unzip noshmchromium.zip

WORKDIR /root/export-app

EXPOSE 8080 3000

# If custom chromium build is not needed, use "google-chrome" instead of "/usr/customchromium/Headless/chrome"
CMD ["/sbin/my_init", "node", "dist/index.js", "/usr/customchromium/Headless/chrome", "5"]
