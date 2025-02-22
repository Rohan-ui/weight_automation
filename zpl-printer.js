const net = require('net');
const { SerialPort } = require('serialport');

class ZPLPrinter {
    constructor(config = {}) {
        this.config = {
            type: config.type || 'network', // 'network' or 'serial'
            address: config.address || '192.168.1.100',
            port: config.port || 9100,
            serialPort: config.serialPort || 'COM1',
            baudRate: config.baudRate || 9600
        };
    }

    generateZPL(data) {
        // Start ZPL format
        let zpl = '^XA';
    
        // Set print darkness
        zpl += '^MD30';
    
        // Label setup for 4x4 inches (812 x 812 dots)
        zpl += '^PW812';   // Print width
        zpl += '^LL812';   // Label length
        zpl += '^LH0,10'; // Adjusted home position
        zpl += '^LT-400';
        zpl += '^CI28';    // Unicode encoding
    
        // Define table data
        const fields = [
            { label: 'Date', value: new Date(data.date || data.timestamp).toLocaleDateString() },
            { label: 'Roll No.', value: data.rollNo || '' },
            { label: 'Width', value: (data.width || '') + (data.width ? ' mm' : '') },
            { label: 'Film Mic', value: (data.filmMic || '') + (data.filmMic ? ' microns' : '') },
            { label: 'Coating', value: (data.coating || '') + (data.coating ? ' microns' : '') },
            { label: 'Colour', value: data.colour || '' },
            { label: 'Style', value: data.style || '' },
            { label: 'Length', value: (data.length || '') + (data.length ? ' m' : '') },
            { label: 'Net Weight', value: (data.netWeight || '') + (data.netWeight ? ' KG' : '') },
            { label: 'Core Weight', value: (data.coreWeight || '') + (data.coreWeight ? ' KG' : '') },
            { label: 'Gross Weight', value: (data.grossWeight || '') + (data.grossWeight ? ' KG' : '') },
            { label: 'Operator', value: data.operator || '' }
        ];
    
// Adjusted values
const startX = 10;      // Left margin remains same
const startY = -150;    // Move label UP by 2 inches (1 inch = ~75 dots)
const rowHeight = 70;   // Increased row height for better spacing
const tableWidth = 900; // Increased width for larger text
const fontSize = 50;    // Increased font size for better readability

// Draw outer box
zpl += `^FO${startX},${startY}^GB${tableWidth},${fields.length * rowHeight},3^FS`;

// Draw vertical divider (centered)
const middleX = startX + (tableWidth / 2);
zpl += `^FO${middleX},${startY}^GB3,${fields.length * rowHeight},3^FS`;

// Add rows and text
fields.forEach((field, index) => {
    const yPos = startY + (index * rowHeight);

    // Draw horizontal line (except for first row)
    if (index > 0) {
        zpl += `^FO${startX},${yPos}^GB${tableWidth},3,3^FS`;
    }

    // Label column
    zpl += `^FO${startX },${yPos }^A0N,${fontSize},${fontSize}^FD${field.label}^FS`;

    // Value column
    zpl += `^FO${middleX },${yPos}^A0N,${fontSize},${fontSize}^FD${field.value}^FS`;
});
    
        // End ZPL format
        zpl += '^XZ';
    
        return zpl;
    }
    

    async print(data) {
        const zplData = this.generateZPL(data);

        if (this.config.type === 'network') {
            return this.printNetwork(zplData);
        } else {
            return this.printSerial(zplData);
        }
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
                baudRate: this.config.baudRate
            });

            port.write(zplData, (err) => {
                if (err) {
                    reject(err);
                } else {
                    port.close(() => resolve());
                }
            });

            port.on('error', (err) => {
                reject(err);
            });
        });
    }
}

module.exports = ZPLPrinter;
