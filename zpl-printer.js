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
        // Set label dimensions: 800x800 dots (~3.94 x 3.94 inches at 203 DPI)
        zpl += '^PW800^LL800^LH0,0^CI28';
        
        // Outer border and vertical divider
        zpl += '^FO0,0^GB800,800,2^FS'; // Box: 800x800 dots
        zpl += '^FO400,0^GB2,800,2^FS'; // Vertical divider at center (400 dots)

        // Define 12 fields
        const fields = [
            { label: 'Date', value: '' }, // Populated below
            { label: 'Roll No.', value: data.rollNo || '' },
            { label: 'Width', value: data.width ? `${data.width} mm` : '' },
            { label: 'Film Mic', value: data.filmMic ? `${data.filmMic} micron` : '' },
            { label: 'Coating', value: data.coating ? `${data.coating} micron` : '' },
            { label: 'Colour', value: data.colour || '' },
            { label: 'Style', value: data.style || '' },
            { label: 'Length', value: data.length ? `${data.length} m` : '' },
            { label: 'Net Weight', value: data.netWeight ? `${data.netWeight} kg` : '' },
            { label: 'Core Weight', value: data.coreWeight ? `${data.coreWeight} kg` : '' },
            { label: 'Gross Weight', value: data.grossWeight ? `${data.grossWeight} kg` : '' },
            { label: 'Operator', value: data.operator || '' }
        ];

        // Calculate date and shift
        const systemDate = new Date();
        const day = String(systemDate.getDate()).padStart(2, '0');
        const month = String(systemDate.getMonth() + 1).padStart(2, '0');
        const year = systemDate.getFullYear();
        const formattedDate = `${day}/${month}/${year}`;
        const hours24 = systemDate.getHours();
        const minutes = String(systemDate.getMinutes()).padStart(2, '0');
        const hours12 = hours24 % 12 || 12;
        const period = hours24 >= 12 ? 'PM' : 'AM';
        const formattedTime = `${hours12}:${minutes} ${period}`;
        const shift = (hours24 >= 8 && hours24 < 20) ? 'Shift I' : 'Shift II';
        fields[0].value = `${formattedDate} ${shift}`;

        // Spacing: 800 dots height / 12 fields = ~66 dots per field
        const ySpacing = Math.floor(800 / 12); // Approx 66 dots per field
        const fontSize = 34; // Font size for readability
        
        // Draw horizontal lines and text
        fields.forEach((field, index) => {
            const y = index * ySpacing; // Position for each field
            if (index < fields.length - 1) {
                // Draw horizontal line except for the last field
                zpl += `^FO0,${y + ySpacing}^GB800,2,2^FS`;
            }
            // Left column (labels): Adjust to fit within 400-dot width
            zpl += `^FO10,${y + 10}^A0N,${fontSize},${fontSize}^FD${field.label}^FS`;
            // Right column (values): Start at 410 to stay right of divider
            zpl += `^FO410,${y + 10}^A0N,${fontSize},${fontSize}^FD${field.value}^FS`;
        });

        zpl += '^XZ';
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
