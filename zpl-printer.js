const net = require('net');
const { SerialPort } = require('serialport');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require("os");

class ZPLPrinter {
    constructor(config = {}) {
        this.config = {
            type: config.type || 'usb', // 'usb', 'network', or 'serial'
            printerName: 'ZebraPrinter', // Dynamically set by user
            printerPort: config.printerPort || '', // Dynamically set
            address: config.address || '192.168.1.100',
            port: config.port || 9100,
            serialPort: config.serialPort || 'COM1',
            baudRate: config.baudRate || 9600
        };
    }

    static async getPrinters() {
        return new Promise((resolve, reject) => {
            exec('wmic printer get Name', (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                } else {
                    const printers = stdout.split("\n").slice(1).map(line => line.trim()).filter(Boolean);
                    resolve(printers);
                }
            });
        });
    }

    generateZPL(data) {
        console.log('generateZPL called with data:', data);
        
        let zpl = '^XA';
        zpl += '^PW752^LL752^LH0,0^CI28';
        zpl += '^FO0,0^GB752,752,2^FS';
        zpl += '^FO376,0^GB2,752,2^FS';

        for (let i = 1; i <= 11; i++) {
            const y = i * 62;
            zpl += `^FO0,${y}^GB752,2,2^FS`;
        }

        const systemDate = new Date();

        // Extract date components in dd/mm/yyyy format
        const day = String(systemDate.getDate()).padStart(2, '0');
        const month = String(systemDate.getMonth() + 1).padStart(2, '0'); // Months are 0-based
        const year = systemDate.getFullYear();
        const formattedDate = `${day}/${month}/${year}`;
    
        // Extract time components
        const hours24 = systemDate.getHours();
        const minutes = String(systemDate.getMinutes()).padStart(2, '0');
    
        // Convert to 12-hour format with AM/PM
        const hours12 = hours24 % 12 || 12;
        const period = hours24 >= 12 ? 'PM' : 'AM';
        const formattedTime = `${hours12}:${minutes} ${period}`;
    
        // Determine the shift
        const shift = (hours24 >= 8 && hours24 < 20) ? 'Shift I' : 'Shift II';
    
        // Output results
        console.log('System Date & Time:', systemDate.toString()); // Full system time
        console.log('Parsed IST Date:', formattedDate);
        console.log('Formatted IST Time:', formattedTime);
        console.log('Shift:', shift);

        const fields = [
            { label: 'Date', value: `${formattedDate} ${shiftLabel}` },
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

        fields.forEach((field, index) => {
            const y = (index * 62) + 10;
            zpl += `^FO20,${y}^A0N,38,38^FD${field.label}^FS`;
            zpl += `^FO400,${y}^A0N,38,38^FD${field.value}^FS`;
        });

        zpl += '^XZ\n^FF';
        return zpl;
    }

    async print(data) {
        console.log('print method called with data:', data);
        const zplData = this.generateZPL(data);
        console.log('Generated ZPL:', zplData);

        if (this.config.type === 'usb') {
            return this.printUSB(zplData);
        } else if (this.config.type === 'network') {
            return this.printNetwork(zplData);
        } else {
            return this.printSerial(zplData);
        }
    }

    printUSB(zplData) {
        return new Promise((resolve, reject) => {
            const desktopName = os.hostname();
            const printerShareName = `\\\\${desktopName}\\${this.config.printerName}`;

            const tempFile = path.join(os.tmpdir(), "temp_label.zpl");
            fs.writeFileSync(tempFile, zplData, 'utf8');

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
                path: this.config.serialPort,
                baudRate: this.config.baudRate,
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
