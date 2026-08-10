# Nginx Configuration for Large File Uploads

## Problem

Getting **413 Request Entity Too Large** error when uploading files.

## Solution

Nginx has a default `client_max_body_size` of **1MB**, which blocks large uploads. You need to increase this limit.

---

## Nginx Configuration Steps

### 1. Find Your Nginx Config File

```bash
# Common locations:
/etc/nginx/nginx.conf
/etc/nginx/conf.d/default.conf
/etc/nginx/sites-available/default
/etc/nginx/sites-enabled/default
```

### 2. Update Configuration

Add/modify these lines in the appropriate location:

#### **Option A: Global Level** (affects all sites)

Edit `/etc/nginx/nginx.conf` in the `http` block:

```nginx
http {
    ...
    # Increase max upload size to 100MB
    client_max_body_size 100M;

    # Increase timeouts for large uploads
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    send_timeout 300s;
    ...
}
```

#### **Option B: Server Block Level** (specific to one domain)

Edit `/etc/nginx/conf.d/default.conf` or `/etc/nginx/sites-available/default`:

```nginx
server {
    listen 80;
    server_name api.Hopping deals.com;

    # Increase max upload size to 100MB
    client_max_body_size 100M;

    # Increase timeouts for large uploads
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    send_timeout 300s;

    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### **Option C: Location Block Level** (specific to upload endpoint)

```nginx
location /api/admin/templates/upload {
    client_max_body_size 100M;

    proxy_pass http://localhost:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Increase timeouts
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
}
```

### 3. Verify Syntax

```bash
sudo nginx -t
```

Expected output:

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 4. Reload Nginx

```bash
sudo systemctl reload nginx
# OR
sudo service nginx reload
```

---

## Summary of Configuration

| Parameter    | Backend (app.js) | Backend (multer) | Nginx                |
| ------------ | ---------------- | ---------------- | -------------------- |
| **Limit**    | 50MB             | 50MB per file    | 100MB                |
| **Location** | express.json()   | multer config    | client_max_body_size |

---

## Testing

After applying all changes, test the upload:

1. **Local development**: Should work with Express limits
2. **Production**: Test with curl:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "images=@image1.jpg" \
  -F "images=@image2.jpg" \
  https://api.Hopping deals.com/api/admin/templates/upload
```

---

## Troubleshooting

| Error                 | Solution                                                         |
| --------------------- | ---------------------------------------------------------------- |
| Still getting 413     | Check if nginx reloaded properly: `sudo service nginx status`    |
| Large uploads timeout | Increase `proxy_read_timeout` in nginx (currently 300s)          |
| Multiple files fail   | Reduce number of files per upload or increase all limits further |
| Connection reset      | Increase `send_timeout` in nginx                                 |

---

## Why These Values?

- **50MB Express limit**: Handles JSON requests + file metadata
- **50MB Multer per file**: Supports individual large images
- **100MB Nginx limit**: Allows uploading up to 10 files × 10MB each with overhead
- **300s timeouts**: Prevents connection drops during large transfers

Adjust these values based on your needs and server capacity.
