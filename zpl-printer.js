const net = require('net');
const { SerialPort } = require('serialport');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class ZPLPrinter {
    constructor(config = {}) {
        this.config = {
            type: config.type || 'usb', // 'usb', 'network', or 'serial'
            printerName: config.printerName || 'ZDesigner ZD230-203dpi ZPL', // Name of your Zebra printer
            printerPort: 'USB001', // Hardcoded printer port
            address: config.address || '192.168.1.100',
            port: config.port || 9100,
            serialPort: config.serialPort || 'COM1',
            baudRate: config.baudRate || 9600,
            deviceId: config.deviceId || '', // USB device ID
            driverName: config.driverName || 'usbprint.inf' // Driver name
        };
    }

    generateZPL(data) {
        console.log('generateZPL called with data:', data);
        
        // Start ZPL format
        let zpl = '^XA';
        zpl += '^PW752';  // Print width
        zpl += '^LL752';  // Label length
        zpl += '^LH0,0';  // Home position
        zpl += '^CI28';   // Unicode encoding

        // Draw outer box and vertical divider
        zpl += '^FO0,0^GB752,752,2^FS';
        zpl += '^FO376,0^GB2,752,2^FS';

        // Draw horizontal lines
        for (let i = 1; i <= 11; i++) {
            const y = i * 62;
            zpl += `^FO0,${y}^GB752,2,2^FS`;
        }

        // Define fields and their positions
        const fields = [
            { label: 'Date', value: new Date(data.date || data.timestamp).toLocaleDateString() },
            { label: 'Roll No.', value: data.rollNo || '' },
            { label: 'Width', value: data.width ? `${data.width} mm` : '' },
            { label: 'Film Mic', value: data.filmMic ? `${data.filmMic} microns` : '' },
            { label: 'Coating', value: data.coating ? `${data.coating} microns` : '' },
            { label: 'Colour', value: data.colour || '' },
            { label: 'Style', value: data.style || '' },
            { label: 'Length', value: data.length ? `${data.length} m` : '' },
            { label: 'Net Weight', value: data.netWeight ? `${data.netWeight} kg` : '' },
            { label: 'Core Weight', value: data.coreWeight ? `${data.coreWeight} kg` : '' },
            { label: 'Gross Weight', value: data.grossWeight ? `${data.grossWeight} kg` : '' },
            { label: 'Operator', value: data.operator || '' }
        ];

        console.log('Fields to print:', fields);

        // Add field labels and values
        fields.forEach((field, index) => {
            const y = (index * 62) + 10;
            // Label (left column)
            zpl += `^FO20,${y}^A0N,38,38^FD${field.label}^FS`;
            // Value (right column)
            zpl += `^FO400,${y}^A0N,38,38^FD${field.value}^FS`;
        });

        // End ZPL format with Form Feed command
        zpl += '^XZ\n^FF';
        
        console.log('Final ZPL code:', zpl);
        return zpl;
    }
    

    async print(data) {
        console.log('print method called with data:', data);
        const zplData = this.generateZPL(data);
        console.log('Generated ZPL:', zplData);

        if (this.config.type === 'usb') {
            console.log('Using USB printer');
            return this.printUSB(zplData);
        } else if (this.config.type === 'network') {
            console.log('Using network printer');
            return this.printNetwork(zplData);
        } else {
            console.log('Using serial printer');
            return this.printSerial(zplData);
        }
    }


    printUSB(zplData) {
        return new Promise((resolve, reject) => {
            const printerShareName = "\\\\DESKTOP-EDMAHFF\\ZebraPrinter";
    
            // Create a temporary file in the system temp directory
            const tempFile = "C:\\port\\temp_label.zpl";
            
            // Use the COPY command to send the file directly to the printer
            exec(`COPY /B "${tempFile}" "${printerShareName}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error("Printing failed:", error);
                    reject(error);
                } else {
                    console.log("Print job sent successfully:", stdout);
                    resolve(stdout);
                }
            });
        });
    }
    

    printNetwork(zplData) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();

            client.connect(this.config.port, this.config.address, () => {
                client.write(zplData, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        client.end();
                        resolve();
                    }
                });
            });

            client.on('error', (err) => {
                reject(err);
            });
        });
    }

    printSerial(zplData) {
        return new Promise((resolve, reject) => {
            const port = new SerialPort({
                path: "COM4", // Use your correct COM port
                baudRate: 9600,
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                flowControl: false,
                autoOpen: false
            });
    
            port.open((err) => {
                if (err) {
                    console.error("Error opening serial port:", err);
                    reject(err);
                    return;
                }
    
                port.write(zplData, (err) => {
                    if (err) {
                        console.error("Error writing to serial port:", err);
                        reject(err);
                    } else {
                        console.log("Print job sent successfully!");
                        resolve();
                    }
    
                    port.close();
                });
            });
    
            port.on('error', (err) => {
                console.error("Serial port error:", err);
                reject(err);
            });
        });
    }
    
}

module.exports = ZPLPrinter;
