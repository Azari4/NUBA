require('dotenv').config();
const express = require('express');
const fs = require('fs');
const { createDatabase } = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

const mailer = process.env.EMAIL_USER && process.env.EMAIL_PASS ? nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
}) : null;

if (!process.env.JWT_SECRET) {
    console.error("ERROR CRÍTICO: JWT_SECRET no está configurado en .env");
    process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
    console.error("ERROR CRÍTICO: ADMIN_PASSWORD no está configurado en .env");
    process.exit(1);
}
if (!process.env.DATABASE_URL) {
    console.error('ERROR CRÍTICO: DATABASE_URL no está configurada. Usá la cadena de conexión de Supabase.');
    process.exit(1);
}

const app = express(); 
app.set('trust proxy', 1); // Trust reverse proxy (Netlify/Render) for accurate IP rate limiting
let db;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const secret = process.env.JWT_SECRET;
app.use(express.json()); app.use(cookieParser()); app.use(express.static(path.join(__dirname, 'public')));

// Admin Middleware
const adminOnly=(req,res,next)=>{ try { req.user=jwt.verify(req.cookies.nuba_admin||'',secret); next(); } catch { res.status(401).json({error:'Acceso no autorizado'}); } };

// Helpers
const catalogCategory=name=>{const n=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(/puzzle|rompecabezas|montessori|nino|juguete|jirafa|elefante|cocodrilo/.test(n))return 5;if(/llavero|arete|pendiente|joya|marcapaginas|spotify/.test(n))return 3;if(/figura|anime|gojo|miku|hollow|groot|jesus|angel|arcangel|dinosaurio|trex|velociraptor|gato|perro|pulpo|serpiente/.test(n))return 4;if(/soporte|organizador|porta|estante|colgador|filtro|toalla|cubierto|lapiz|herramienta|auricular|controlador|telefono/.test(n))return 2;return 1;};
const makeSlug=(name,suffix='')=>(name+suffix).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const saveVariants=async (productId,variants=[],database=db)=>{await database.run('DELETE FROM product_variants WHERE product_id=?',productId);const add=await database.prepare('INSERT INTO product_variants(product_id,name,value,additional_price,stock,dimensions) VALUES(?,?,?,?,?,?)');for(const v of variants.filter(x=>x.value?.trim())){await add.run(productId,'Tamaño',v.value.trim(),Number(v.additional_price)||0,Math.max(0,Number(v.stock)||0),v.dimensions||'');}await add.finalize();};
const saveImages=async (productId,images=[],database=db)=>{const clean=[...new Set(images.map(x=>String(x).trim()).filter(Boolean))];await database.run('DELETE FROM product_images WHERE product_id=?',productId);const add=await database.prepare('INSERT INTO product_images(product_id,image_url,sort_order) VALUES(?,?,?)');for(let i=0;i<clean.length;i++){await add.run(productId,clean[i],i);}await add.finalize();if(clean.length)await database.run('UPDATE products SET image=? WHERE id=?',clean[0],productId);};
const withVariants=async p=>{if(!p)return p;return {...p,variants:await db.all('SELECT * FROM product_variants WHERE product_id=? ORDER BY additional_price',p.id),images:await db.all('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order,id',p.id)};};

let dbInitPromise = (async () => {
  db = createDatabase(process.env.DATABASE_URL);
  await db.exec(fs.readFileSync(path.join(__dirname, 'migrations', '001_initial.sql'), 'utf8'));

  const countRow = await db.get('SELECT COUNT(*) as count FROM products');
  if (countRow.count === 0) {
    const cats=[['Deco para tu hogar','Objetos para decorar y darle personalidad a tus espacios.','✦'],['Organización y funcionalidad','Todo más práctico y ordenado.','⌘'],['Accesorios personalizados','Detalles hechos especialmente para vos.','♡'],['Regalos para sorprender','Ideas originales para regalar.','🎁'],['Ideas para bebés y niños','Útiles, tiernos y especiales.','☁'],['Y muchas ideas más','Pequeños tesoros para descubrir.','✿']]; 
    const ci=await db.prepare('INSERT INTO categories(name,description,icon,sort_order) VALUES(?,?,?,?)'); 
    for(let i=0;i<cats.length;i++) await ci.run(cats[i][0],cats[i][1],cats[i][2],i);
    await ci.finalize();
    const ps=[['Organizador de escritorio','organizador-escritorio','Un rincón lindo para tus ideas, lápices y pequeñas cosas importantes.',8500,1,12,'PLA premium','15 × 10 × 8 cm','Salvia, Rosa, Marfil',1,1,'organizer'],['Maceta Nube','maceta-nube','Una maceta suave y divertida para acompañar tus plantitas favoritas.',6200,1,8,'PLA premium','12 × 10 cm','Marfil, Rosa',0,1,'cloud'],['Llavero personalizado','llavero-personalizado','Un detalle único con el nombre o palabra que quieras llevar siempre.',3500,3,20,'PLA premium','6 × 4 cm','Rosa, Salvia, Terracota',1,0,'key'],['Porta lápices Flor','porta-lapices-flor','Para que tu escritorio se vea tan lindo como ordenado.',7200,2,5,'PLA premium','10 × 10 cm','Rosa, Terracota',0,1,'flower'],['Mini arcoíris deco','mini-arcoiris-deco','Pequeña dosis de alegría para cualquier estante.',4800,1,7,'PLA premium','14 × 8 cm','Rosa, Salvia, Marfil',0,0,'rainbow'],['Nombre para habitación','nombre-habitacion','Un cartel delicado y personal para su espacio favorito.',9900,5,4,'PLA premium','A medida','A elección',1,1,'name']]; 
    const pi=await db.prepare('INSERT INTO products(name,slug,description,price,category_id,stock,material,dimensions,colors,customizable,is_new,featured,image,preparation_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); 
    for(let i=0;i<ps.length;i++) await pi.run(ps[i][0],ps[i][1],ps[i][2],ps[i][3],ps[i][4],ps[i][5],ps[i][6],ps[i][7],ps[i][8],ps[i][9],i===0||i===3?1:0,ps[i][10],ps[i][11],'En el día, sujeto a disponibilidad');
    await pi.finalize();
  }

  await db.run("UPDATE products SET active=0 WHERE sku LIKE 'MACETA-%'");
  const macetas=[['Maceta Corazón','maceta-corazon','MACETA-CORAZON','/assets/maceta-corazon.png'],['Maceta Tacita','maceta-tacita','MACETA-TACITA','/assets/maceta-tacita.png'],['Maceta Paz','maceta-paz','MACETA-PAZ','/assets/maceta-paz.png'],['Maceta Corazones','maceta-corazones','MACETA-CORAZONES','/assets/maceta-corazones.png'],['Maceta Abrazos','maceta-abrazos','MACETA-ABRAZOS','/assets/maceta-abrazos.png'],['Maceta Mariposa','maceta-mariposa','MACETA-MARIPOSA','/assets/maceta-mariposa.png'],['Maceta Besito','maceta-besito','MACETA-BESITO','/assets/maceta-besito.png']];
  const addMaceta=await db.prepare('INSERT INTO products(name,slug,description,price,category_id,stock,sku,material,dimensions,colors,featured,is_new,active,image,preparation_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const addSize=await db.prepare('INSERT INTO product_variants(product_id,name,value,additional_price,stock) VALUES(?,?,?,?,?)');
  for(const m of macetas){
    let p=await db.get('SELECT id FROM products WHERE sku=?',m[2]);
    if(!p){
        const r=await addMaceta.run(m[0],m[1],'Maceta con personalidad para darle un toque tierno a tus plantas.',5000,1,20,m[2],'PLA premium','Chica: 8 × 8 cm · Mediana: 12 × 12 cm','Rosa, terracota o marfil',1,1,1,m[3],'En el día, sujeto a disponibilidad');
        p={id:r.lastID};
    }else{
        await db.run('UPDATE products SET active=1,price=5000,image=?,dimensions=?,preparation_time=? WHERE id=?',m[3],'Chica: 8 × 8 cm · Mediana: 12 × 12 cm','En el día, sujeto a disponibilidad',p.id);
    }
    const varExists = await db.get('SELECT id FROM product_variants WHERE product_id=?',p.id);
    if(!varExists){
        await addSize.run(p.id,'Tamaño','Chica',0,10);
        await addSize.run(p.id,'Tamaño','Mediana',4000,10);
    }
  }
  await addMaceta.finalize();
  await addSize.finalize();
  const cats2=[['Decoración y hogar','Objetos para hacer más lindo tu espacio.','✦',1],['Organización y soportes','Soluciones prácticas para tu día a día.','⌘',2],['Accesorios y personalizados','Detalles pequeños que hablan de vos.','♡',3],['Regalos y coleccionables','Figuras y detalles para sorprender.','🎁',4],['Niños y juegos','Ideas para crear, jugar y aprender.','☁',5]];
  for(const c of cats2) await db.run('UPDATE categories SET name=?,description=?,icon=?,active=1,sort_order=? WHERE id=?',c[0],c[1],c[2],c[3],c[3]);
  await db.run('UPDATE categories SET active=0 WHERE id=6');

  // Start Server after DB init
  if (require.main === module) {
    const port = process.env.PORT || 4000;
    app.listen(port, () => console.log(`NUBA lista en http://localhost:${port}`));
  }
})();

dbInitPromise.catch(error => {
  console.error('No se pudo inicializar la base de datos:', error.message);
  if (require.main === module) process.exit(1);
});

app.use(async (req, res, next) => {
  try {
    await dbInitPromise;
    next();
  } catch (err) {
    res.status(500).json({error: 'Error de inicialización de base de datos'});
  }
});

app.post('/api/admin/import-catalog',adminOnly,upload.single('catalog'),async (req,res)=>{
  if(!req.file)return res.status(400).json({error:'Seleccioná un archivo CSV.'});
  let rows;
  try{
    const csvContent = req.file.buffer.toString('utf8').replace(/^\uFEFF/,'');
    rows = parse(csvContent, { columns: true, skip_empty_lines: true });
  }catch(e){
    console.error(e);
    return res.status(400).json({error:'No pudimos leer ese CSV.'})
  }
  let imported=0,skipped=0;
  try{
    await db.transaction(async database => {
    const add=await database.prepare('INSERT INTO products(name,slug,description,price,category_id,stock,sku,material,dimensions,colors,customizable,featured,is_new,active,image,preparation_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for(let i=0;i<rows.length;i++){
      const name=(rows[i].data||rows[i].name||'').trim(),image=(rows[i].image||'').trim();
      if(!name||!image){skipped++;continue}
      const sku='CSV-'+crypto.createHash('sha1').update(image).digest('hex');
      const exists=await database.get('SELECT id FROM products WHERE sku=? OR image=?',sku,image);
      if(exists){skipped++;continue}
      let slug=makeSlug(name);
      let suffix=2;
      while(await database.get('SELECT id FROM products WHERE slug=?',slug))slug=makeSlug(name,'-'+suffix++);
      const r=await add.run(name,slug,'Diseño impreso en 3D. Elegí el tamaño que mejor se adapte a tu espacio.',0,catalogCategory(name),0,sku,'PLA premium','A definir según tamaño','A elección',0,0,1,1,image,'A coordinar');
      const id=r.lastID;
      await saveVariants(id,[{value:'10 cm',additional_price:0,stock:0},{value:'15 cm',additional_price:0,stock:0},{value:'20 cm',additional_price:0,stock:0}],database);
      imported++;
    }
    await add.finalize();
    });
    res.json({imported,skipped,total:rows.length});
  }catch(err){
    console.error('Error al importar catálogo:', err.message);
    res.status(500).json({error:'La importación no pudo completarse.'});
  }
});

app.get('/api/categories',async (req,res)=>res.json(await db.all('SELECT * FROM categories WHERE active=1 ORDER BY sort_order')));
app.get('/api/public-config',(req,res)=>res.json({whatsappNumber:process.env.WHATSAPP_NUMBER||''}));
app.get('/api/products',async (req,res)=>{
  let q='SELECT p.*, c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.active=1';
  const a=[];
  if(req.query.category){q+=' AND p.category_id=?';a.push(req.query.category)}
  if(req.query.subcategory){q+=' AND p.subcategory=?';a.push(req.query.subcategory)}
  if(req.query.search){q+=' AND p.name LIKE ?';a.push('%'+req.query.search+'%')}
  const sort={price_asc:'p.price ASC',price_desc:'p.price DESC',new:'p.is_new DESC,p.created_at DESC'}[req.query.sort]||'p.featured DESC,p.created_at DESC';
  const prods = await db.all(q+' ORDER BY '+sort, ...a);
  const populated = await Promise.all(prods.map(p=>withVariants(p)));
  res.json(populated);
});
app.get('/api/products/:slug',async (req,res)=>{
  const p = await db.get('SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.slug=? AND p.active=1',req.params.slug);
  if(p)res.json(await withVariants(p));else res.status(404).json({error:'No encontrado'});
});

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Recibimos demasiados pedidos desde esta conexión. Por favor intentá de nuevo más tarde.' }
});

app.post('/api/orders', orderLimiter, async (req,res)=>{
  const {customer,items}=req.body;
  if(!customer?.name||!customer?.phone||!items?.length)return res.status(400).json({error:'Completá nombre, teléfono y productos.'});
  if(!Array.isArray(items)||items.length>25)return res.status(400).json({error:'El pedido no es válido.'});
  let subtotal=0, lines=[], number;
  try {
    await db.transaction(async database => {
      for(const it of items){
        const quantity=Number(it.quantity);
        if(!Number.isInteger(quantity)||quantity < 1 || quantity > 20) throw new Error('La cantidad de un producto no es válida.');
        const p=await database.get('SELECT * FROM products WHERE id=? AND active=1',Number(it.id));
        if(!p) throw new Error('Un producto ya no está disponible.');
        const v=it.variantId?await database.get('SELECT * FROM product_variants WHERE id=? AND product_id=?',Number(it.variantId),p.id):null;
        if(it.variantId&&!v) throw new Error('La variante seleccionada ya no está disponible.');
        if(lines.some(line=>line.p.id===p.id && (line.v?.id||null)===(v?.id||null))) throw new Error('Cada producto debe figurar una sola vez en el pedido.');
        const price=Number(p.price)+(Number(v?.additional_price)||0);
        if(price <= 0) throw new Error(`${p.name} todavía no tiene un precio definido.`);
        subtotal+=price*quantity;
        lines.push({p,v,price,quantity,customization:String(it.customization||'').slice(0,180)});
      }
      number=`NUBA-${Date.now()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const order=await database.run('INSERT INTO orders(order_number,customer_name,customer_phone,customer_location,delivery_method,comments,subtotal,total) VALUES(?,?,?,?,?,?,?,?)',number,String(customer.name).trim().slice(0,100),String(customer.phone).trim().slice(0,40),String(customer.location||'').trim().slice(0,100),String(customer.delivery||'').trim().slice(0,50),String(customer.comments||'').trim().slice(0,500),subtotal,subtotal);
      const ii=await database.prepare('INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price,variant,customization) VALUES(?,?,?,?,?,?,?)');
      for(const x of lines){
        await ii.run(order.lastID,x.p.id,x.p.name,x.quantity,x.price,x.v?.value||'',x.customization);
      }
      await ii.finalize();
    });
  } catch (error) {
    return res.status(400).json({error:error.message||'No pudimos registrar el pedido.'});
  }
  const totalQuantity = lines.reduce((acc, x) => acc + x.quantity, 0);
  const requiresDeposit = totalQuantity > 5 || lines.some(x => x.p.customizable);
  const commitment = requiresDeposit 
    ? "Entiendo que al ser un pedido personalizado o mayorista, el tiempo de preparación es de 1 a 3 días y requiere una seña del 50%."
    : "Entiendo que, de no haber stock para entrega inmediata, el tiempo de preparación es de 1 a 3 días según demanda.";
  
  const msg=`Hola NUBA! ♡ Confirmo mi pedido:%0A%0APEDIDO ${number}%0A%0AProductos:%0A${lines.map(x=>`• ${x.p.name}${x.v?' ('+x.v.value+')':''} — x${x.quantity} — $${(x.price*x.quantity).toLocaleString('es-AR')}`).join('%0A')}%0A%0ASubtotal: $${subtotal.toLocaleString('es-AR')}%0A%0ANombre: ${customer.name}%0ATeléfono: ${customer.phone}%0ALocalidad: ${customer.location||'-'}%0AEntrega: ${customer.delivery||'-'}%0A%0AComentarios:%0A${customer.comments||'-'}%0A%0A${commitment}%0A%0A¡Gracias!`;
  
  if (mailer && process.env.NOTIFICATION_EMAIL) {
    const htmlLines = lines.map(x => `<li><b>${x.p.name}</b>${x.v ? ' (' + x.v.value + ')' : ''} x${x.quantity} - $${(x.price * x.quantity).toLocaleString('es-AR')}</li>`).join('');
    mailer.sendMail({
      from: `"NUBA Tienda" <${process.env.EMAIL_USER}>`,
      to: process.env.NOTIFICATION_EMAIL,
      subject: `🛒 Nuevo Pedido: ${number} - $${subtotal.toLocaleString('es-AR')}`,
      html: `<div style="font-family:sans-serif;color:#333;line-height:1.5">
        <h2 style="color:#d87c6b">¡Nuevo pedido en NUBA!</h2>
        <p><b>Pedido:</b> ${number}</p>
        <p><b>Cliente:</b> ${customer.name}</p>
        <p><b>Teléfono:</b> <a href="https://wa.me/${String(customer.phone).replace(/\\D/g,'')}">${customer.phone}</a></p>
        <p><b>Total:</b> $${subtotal.toLocaleString('es-AR')}</p>
        <p><b>Entrega:</b> ${customer.delivery||'-'} (${customer.location||'-'})</p>
        <p><b>Comentarios:</b> ${customer.comments||'-'}</p>
        <hr>
        <h3>Productos:</h3>
        <ul>${htmlLines}</ul>
      </div>`
    }).catch(e => console.error('Error enviando alerta por email:', e));
  }

  res.json({orderNumber:number,total:subtotal,whatsapp:`https://wa.me/${process.env.WHATSAPP_NUMBER||'54911'}?text=${encodeURIComponent(decodeURIComponent(msg))}`});
});

app.post('/api/admin/login',(req,res)=>{
  const ok=req.body.username===(process.env.ADMIN_USER||'admin_default')&&req.body.password===process.env.ADMIN_PASSWORD;
  if(!ok)return res.status(401).json({error:'Usuario o contraseña incorrectos'});
  res.cookie('nuba_admin',jwt.sign({role:'admin'},secret),{httpOnly:true,sameSite:'strict',maxAge:86400000});
  res.json({ok:true})
});
app.post('/api/admin/logout',adminOnly,(req,res)=>{res.clearCookie('nuba_admin');res.json({ok:true})});
app.get('/api/admin/dashboard',adminOnly,async (req,res)=>res.json({products:(await db.get('SELECT COUNT(*) n FROM products')).n,active:(await db.get('SELECT COUNT(*) n FROM products WHERE active=1')).n,orders:await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8')}));
app.get('/api/admin/products',adminOnly,async (req,res)=>{
  const prods=await db.all('SELECT p.*,c.name category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC');
  const populated = await Promise.all(prods.map(p=>withVariants(p)));
  res.json(populated);
});
app.post('/api/admin/products',adminOnly,async (req,res)=>{
  const p=req.body,images=Array.isArray(p.images)?p.images:[];const slug=makeSlug(p.slug||p.name);
  const r=await db.run('INSERT INTO products(name,slug,description,price,category_id,subcategory,stock,material,dimensions,colors,customizable,featured,is_new,active,image,preparation_time) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',p.name,slug,p.description||'',Number(p.price)||0,p.category_id||1,p.subcategory||null,p.stock||0,p.material||'',p.dimensions||'',p.colors||'',p.customizable?1:0,p.featured?1:0,p.is_new?1:0,p.active===false?0:1,images[0]||p.image||'star',p.preparation_time||'');
  const id=r.lastID;
  await saveVariants(id,p.variants);await saveImages(id,images);res.json({id})
});
app.put('/api/admin/products/:id',adminOnly,async (req,res)=>{
  const p=req.body,images=Array.isArray(p.images)?p.images:[];
  await db.run('UPDATE products SET name=?,description=?,price=?,category_id=?,subcategory=?,stock=?,material=?,dimensions=?,colors=?,customizable=?,featured=?,is_new=?,active=?,image=?,preparation_time=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',p.name,p.description||'',Number(p.price)||0,p.category_id||1,p.subcategory||null,p.stock||0,p.material||'',p.dimensions||'',p.colors||'',p.customizable?1:0,p.featured?1:0,p.is_new?1:0,p.active===false?0:1,images[0]||p.image||'star',p.preparation_time||'',req.params.id);
  await saveVariants(Number(req.params.id),p.variants);await saveImages(Number(req.params.id),images);res.json({ok:true})
});
app.delete('/api/admin/products/:id',adminOnly,async (req,res)=>{
  const id=Number(req.params.id);
  await db.run('DELETE FROM products WHERE id=?',id);
  await db.run('DELETE FROM product_variants WHERE product_id=?',id);
  await db.run('DELETE FROM product_images WHERE product_id=?',id);
  res.json({ok:true})
});
app.get('/api/admin/orders',adminOnly,async (req,res)=>res.json(await db.all('SELECT * FROM orders ORDER BY created_at DESC'))); 
app.patch('/api/admin/orders/:id',adminOnly,async (req,res)=>{
  await db.run('UPDATE orders SET status=? WHERE id=?',req.body.status,req.params.id);res.json({ok:true})
});
app.get('/api/admin/categories',adminOnly,async (req,res)=>res.json(await db.all('SELECT * FROM categories ORDER BY sort_order')));
app.post('/api/admin/categories',adminOnly,async (req,res)=>{
  const r=await db.run('INSERT INTO categories(name,description,icon,active,sort_order) VALUES(?,?,?,?,?)',req.body.name||'Nueva',req.body.description||'',req.body.icon||'✦',req.body.active===false?0:1,req.body.sort_order||0);
  res.json({id:r.lastID})
});
app.put('/api/admin/categories/:id',adminOnly,async (req,res)=>{
  await db.run('UPDATE categories SET name=?,description=?,icon=?,active=?,sort_order=? WHERE id=?',req.body.name,req.body.description||'',req.body.icon||'✦',req.body.active===false?0:1,req.body.sort_order||0,req.params.id);
  res.json({ok:true})
});
app.delete('/api/admin/categories/:id',adminOnly,async (req,res)=>{
  await db.run('UPDATE products SET category_id=1 WHERE category_id=?',req.params.id);
  await db.run('DELETE FROM categories WHERE id=?',req.params.id);
  res.json({ok:true})
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html'))); 

module.exports = app;
