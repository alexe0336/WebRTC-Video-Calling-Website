# Video Chat Website

This website allows two people to communicate and chat once a connection has been established.

## Overview

If you copy and paste the code and try to use it on your own, you will be able to make connections using free STUN servers. 
However, I created my own TURN server for my websites usage only. 
If you would like to create your own TURN server, which is better at traversing NAT than a STUN server, you can set it up. 
I use `coturn` hosted on a `t2.micro` Ubuntu AWS EC2 instance for my TURN server.

## Steps to Run the Video Chat Website

### 1. Copy the GitHub Repository

#### Simple Method: Using Glitch

1. **Create a Free Glitch.com Website:**
   - Remix my website's code on Glitch: [Remix Here](https://glitch.com/edit/#!/onlinevideochat)

2. **Link Your GitHub Account:**
   - In Glitch, go to `Tools` -> `Import and Export` -> `Link to GitHub`
   - Export the code to a GitHub repository of your choice.

3. **Use the Remixed URL:**
   - Once you have remixed the website, you will have working code on the remixed URL created by Glitch.

## Setting Up Your Own TURN Server

If you prefer to set up your own TURN server, follow these steps:

1. **Set Up an AWS EC2 Instance:**
   - Launch a `t2.micro` Ubuntu instance on AWS EC2.

2. **Install `coturn`:**
   - SSH into your instance and run the following commands:
     ```sh
     sudo apt update
     sudo apt install coturn
     ```

3. **Configure `coturn`:**
   - Edit the configuration file at `/etc/turnserver.conf` to set up your TURN server. Refer to the [coturn documentation](https://github.com/coturn/coturn) for detailed configuration options.

4. **Start the TURN Server:**
   - Enable and start the TURN server service:
     ```sh
     sudo systemctl enable coturn
     sudo systemctl start coturn
     ```

5. **Update Your Website Code:**
   - Update your website code to use your TURN server credentials.

## Additional Information

For more detailed instructions and information, please refer to the [official documentation](https://github.com/coturn/coturn) of `coturn`.
