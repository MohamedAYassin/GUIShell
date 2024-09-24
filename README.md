
# DISCLAIMER



![MIT License](https://img.shields.io/badge/License-MIT-green.svg)
![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)

**GUI Rat is intended solely for educational and research purposes. The author assumes no responsibility for any misuse or illegal/unauthorized application of this code. This project serves as a foundational reference for multiclient Remote Access Trojan (RAT) programming..** 


# About GUI Rat
This boilerplate GUI Remote Access Tool (RAT) is designed to support multiple clients and offers a range of robust features. Built using socket programming, it facilitates seamless connections and efficient control over client interactions.



## Features
- Installation into Registery for starting at startup
- Reverse Shell Access
- Screenview
- Keylogger

## Requirements
- [Python 3](https://www.python.org/downloads/)

To install and run the program please follow these instructions:
```
# Install pip requirements
pip install -r requirements.txt

# Compile client.pyw into exe 
pyinstaller --onfile client.pyw

# After initial compilation recompile with the exe for installing into system
pyinstaller --onefile --add-data "client.exe;." .\client.pyw
```
Now the program is ready to be ran.

## To Run
```
# On Server
python server.py

# On Client
./client.exe
```

## To Install into target system
Simply right click on the target in the target list and click "Install to System"

## Configuration
To configure the HOST and PORT of the program
```
# On Server
Click on Config in the menu bar

# On Client
Right click the tray icon and click Change ip and port
```

## Other open-source Python RATs for Reference
* [FZGbzuw412/Python-RAT](https://github.com/FZGbzuw412/Python-RAT)

## Screenshots

![shell](https://github.com/MohamedAYassin/GUIShell/blob/main/Screenshots/shell.jpg?raw=true)
![config](https://github.com/MohamedAYassin/GUIShell/blob/main/Screenshots/config.png?raw=true)
![menu](https://github.com/MohamedAYassin/GUIShell/blob/main/Screenshots/menu.png?raw=true)
![screenshare](https://github.com/MohamedAYassin/GUIShell/blob/main/Screenshots/screenshare.jpg?raw=true)


## License

See [LICENSE](/LICENSE)