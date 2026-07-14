using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows;

namespace BalsaOpsDesktop
{
    public partial class MainWindow : Window
    {
        private Process? _nodeProcess; // only set (and only killed on close) if *we* started it
        private const string AppUrl = "http://localhost:3000";

        public MainWindow()
        {
            InitializeComponent();
            Loaded += MainWindow_Loaded;
            Closing += MainWindow_Closing;
        }

        private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
        {
            await webView.EnsureCoreWebView2Async(null);
            ShowLoadingMessage("Starting Balsa Construction Ops…");

            bool alreadyRunning = await IsServerUp();

            if (!alreadyRunning)
            {
                string? appDir = FindAppDirectory();
                if (appDir == null)
                {
                    ShowFatalError(
                        "Could not find server.js.\n\n" +
                        "This app expects to be placed inside (or alongside) the balsa-webapp folder, " +
                        "in the same place as server.js.");
                    return;
                }

                try
                {
                    StartNodeServer(appDir);
                }
                catch (Exception ex)
                {
                    ShowFatalError(
                        "Could not start the server. Is Node.js installed?\n\n" +
                        "Install it for free from https://nodejs.org, then try again.\n\n" +
                        "Details: " + ex.Message);
                    return;
                }

                bool ready = await WaitForServerUp(TimeSpan.FromSeconds(20));
                if (!ready)
                {
                    ShowFatalError(
                        "The server didn't start within 20 seconds.\n\n" +
                        "Make sure Node.js is installed (https://nodejs.org) and that " +
                        "\"npm install\" has been run once in the balsa-webapp folder.");
                    return;
                }
            }

            webView.CoreWebView2.Navigate(AppUrl);
        }

        // Walks upward from this exe's own folder looking for server.js, so this
        // works correctly whether it's built in Debug, Release, or published as
        // a single file — no assumption about exact folder depth.
        private string? FindAppDirectory()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (dir != null)
            {
                if (File.Exists(Path.Combine(dir.FullName, "server.js")))
                    return dir.FullName;
                dir = dir.Parent;
            }
            return null;
        }

        private void StartNodeServer(string appDir)
        {
            var psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "server.js",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            _nodeProcess = Process.Start(psi);
        }

        private async Task<bool> IsServerUp()
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                var resp = await client.GetAsync(AppUrl);
                return resp.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        private async Task<bool> WaitForServerUp(TimeSpan timeout)
        {
            var start = DateTime.Now;
            while (DateTime.Now - start < timeout)
            {
                if (await IsServerUp()) return true;
                await Task.Delay(400);
            }
            return false;
        }

        private void ShowLoadingMessage(string message)
        {
            webView.CoreWebView2.NavigateToString($@"
                <html><body style='font-family:sans-serif;background:#0B0605;color:#EDEAE9;
                display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>
                  <div>{message}</div>
                </body></html>");
        }

        private void ShowFatalError(string message)
        {
            MessageBox.Show(message, "Balsa Construction Ops", MessageBoxButton.OK, MessageBoxImage.Error);
            Application.Current.Shutdown();
        }

        private void MainWindow_Closing(object? sender, CancelEventArgs e)
        {
            // Only stop the server if this window is the one that started it —
            // if it was already running when we opened, leave it running for
            // anyone else using it on the network.
            try
            {
                if (_nodeProcess != null && !_nodeProcess.HasExited)
                {
                    _nodeProcess.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                // Best-effort cleanup; nothing useful to do if this fails.
            }
        }
    }
}
