const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const path = require('path');
const ZPLPrinter = require('./zpl-printer');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

let mainWindow;
let serialPort;
let parser;
let isPortBusy = false;
let zplPrinter;

// Serial port configuration with backup ports
const SERIAL_CONFIG = {
    defaultPath: 'COM5',
    baudRate: 9600,
    alternativePorts: ['COM3', 'COM4', 'COM6']
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
        closeSerialPort().catch(err => {
            console.error('Error closing port during window closure:', err);
        });
    });

    // Initialize ZPL printer after window creation
    zplPrinter = new ZPLPrinter({
        type: 'serial',  // Change to 'network' if using network printer
        serialPort: 'COM4',  // Update this to match your Zebra printer's port
        baudRate: 9600
    });
}

async function listAvailablePorts() {
    try {
        const ports = await SerialPort.list();
        console.log('Available ports:', ports);
        return ports;
    } catch (err) {
        console.error('Error listing ports:', err);
        return [];
    }
}

async function findAvailablePort() {
    try {
        const ports = await listAvailablePorts();
        const availablePorts = ports.map(port => port.path);
        
        if (availablePorts.includes(SERIAL_CONFIG.defaultPath)) {
            return SERIAL_CONFIG.defaultPath;
        }
        
        for (const port of SERIAL_CONFIG.alternativePorts) {
            if (availablePorts.includes(port)) {
                return port;
            }
        }
        
        return null;
    } catch (err) {
        console.error('Error finding available port:', err);
        return null;
    }
}

async function initSerialPort() {
    if (isPortBusy) {
        console.log('Port initialization already in progress...');
        return;
    }
    
    isPortBusy = true;
    
    try {
        const availablePort = await findAvailablePort();
        
        if (!availablePort) {
            throw new Error('No available serial ports found');
        }

        await closeSerialPort();

        return new Promise((resolve, reject) => {
            serialPort = new SerialPort({
                path: availablePort,
                baudRate: SERIAL_CONFIG.baudRate
            }, (err) => {
                isPortBusy = false;
                
                if (err) {
                    handleSerialError('Port initialization failed', err);
                    reject(err);
                    return;
                }
                
                console.log(`Serial port ${availablePort} successfully initialized`);
                notifyRenderer('serial-status', { 
                    connected: true, 
                    port: availablePort 
                });
                
                setupParser();
                resolve();
            });

            serialPort.on('error', (err) => {
                handleSerialError('Serial port error', err);
            });

            serialPort.on('close', () => {
                console.log('Serial port closed');
                notifyRenderer('serial-status', { connected: false });
            });
        });

    } catch (err) {
        isPortBusy = false;
        handleSerialError('Failed to create serial port', err);
        throw err;
    }
}

function setupParser() {
    try {
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        
        parser.on('data', (data) => {
            try {
                // Add debug logging
                const rawData = data.toString();
                console.log('Raw data buffer:', data);
                console.log('Raw data string:', rawData);
                console.log('Raw data hex:', Buffer.from(data).toString('hex'));

                // Clean and parse the data
                const weight = data.toString().trim();
                console.log('Parsed weight:', weight);
                
                // Only send valid weight data
                if (mainWindow && weight.length > 0) {
                    notifyRenderer('update-weight', { 
                        weight, 
                        timestamp: new Date().toISOString(),
                        port: serialPort.path
                    });
                }
            } catch (err) {
                handleSerialError('Data parsing error', err);
            }
        });

        // Add raw data event listener
        serialPort.on('data', (data) => {
            notifyRenderer('update-weight', { 
                weight:data.toString(), 
                timestamp: new Date().toISOString(),
                port: serialPort.path
            });
            console.log('Direct port data:', data.toString());
            console.log('Direct port hex:', data.toString());
        });

    } catch (err) {
        handleSerialError('Parser setup failed', err);
    }
}

async function closeSerialPort() {
    if (serialPort && serialPort.isOpen) {
        return new Promise((resolve, reject) => {
            serialPort.close((err) => {
                if (err) {
                    console.error('Error closing port:', err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
    return Promise.resolve();
}

function handleSerialError(context, error) {
    const errorMessage = `${context}: ${error.message}`;
    console.error(errorMessage);
    
    notifyRenderer('serial-error', {
        context,
        message: error.message,
        timestamp: new Date().toISOString()
    });

    if (!isPortBusy) {
        const delay = 5000;
        console.log(`Will attempt to reconnect in ${delay/1000} seconds...`);
        setTimeout(() => {
            initSerialPort().catch(err => {
                console.error('Reconnection attempt failed:', err);
            });
        }, delay);
    }
}

function notifyRenderer(channel, data) {
    if (mainWindow) {
        mainWindow.webContents.send(channel, data);
    }
}

app.whenReady().then(async () => {
    try {
        createWindow();
        await initSerialPort();
        
        // Check for updates immediately when app starts
        autoUpdater.checkForUpdatesAndNotify();
        
        // Check for updates every 30 minutes
        setInterval(() => {
            autoUpdater.checkForUpdatesAndNotify();
        }, 30 * 60 * 1000);

        // Check for updates
        autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
        console.error('Error during app initialization:', err);
    }
});

app.on('window-all-closed', async () => {
    try {
        await closeSerialPort();
        if (process.platform !== 'darwin') {
            app.quit();
        }
    } catch (err) {
        console.error('Error during app cleanup:', err);
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle('get-available-ports', async () => {
    try {
        return await listAvailablePorts();
    } catch (err) {
        console.error('Error handling get-available-ports:', err);
        return [];
    }
});

ipcMain.on('select-port', async (event, portPath) => {
    try {
        SERIAL_CONFIG.defaultPath = portPath;
        await initSerialPort();
    } catch (err) {
        console.error('Error handling select-port:', err);
        handleSerialError('Port selection failed', err);
    }
});

ipcMain.on('restart-serial', async () => {
    try {
        await initSerialPort();
    } catch (err) {
        console.error('Error handling restart-serial:', err);
        handleSerialError('Restart failed', err);
    }
});

// Add new IPC handler for printing
ipcMain.on('print-label', async (event, data) => {
    try {
        // Calculate gross weight if not provided
        if (!data.grossWeight && data.netWeight && data.coreWeight) {
            data.grossWeight = (parseFloat(data.netWeight) + parseFloat(data.coreWeight)).toFixed(2);
        }

        // Format weights to include units
        if (data.netWeight) data.netWeight += ' KG';
        if (data.coreWeight) data.coreWeight += ' KG';
        if (data.grossWeight) data.grossWeight += ' KG';
        
        // Add units to measurements if provided
        if (data.width) data.width += ' mm';
        if (data.length) data.length += ' m';
        if (data.filmMic) data.filmMic += ' μ';

        await zplPrinter.print(data);
        event.reply('print-status', { success: true });
    } catch (err) {
        console.error('Printing error:', err);
        event.reply('print-status', { 
            success: false, 
            error: err.message 
        });
    }
});

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    notifyRenderer('update-status', 'Checking for update...');
});

autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
    notifyRenderer('update-status', 'Update available. Downloading...');
});

autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
    notifyRenderer('update-status', 'You are running the latest version.');
});

autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
    notifyRenderer('update-status', 'Error checking for updates.');
});

autoUpdater.on('download-progress', (progressObj) => {
    let message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`;
    log.info(message);
    notifyRenderer('update-status', message);
});

autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded:', info);
    notifyRenderer('update-status', 'Update downloaded. Will install on restart.');
});