import cv2
import numpy as np
import os
import glob
import math

def process_all_images(asset_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    images = glob.glob(os.path.join(asset_dir, "*.png"))
    
    extracted = []
    idx = 1
    
    for img_path in images:
        # Read image with chinese path
        try:
            img_data = np.fromfile(img_path, dtype=np.uint8)
            img = cv2.imdecode(img_data, cv2.IMREAD_UNCHANGED)
        except Exception as e:
            print(f"Error loading {img_path}: {e}")
            continue

        if img is None:
            print(f"Failed to load {img_path}")
            continue
            
        print(f"Processing {os.path.basename(img_path)}...")
        
        # Ensure alpha channel
        if img.shape[2] == 3:
            b, g, r = cv2.split(img)
            alpha = np.ones(b.shape, dtype=b.dtype) * 255
            img = cv2.merge((b, g, r, alpha))
            
        hsv = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2HSV)
        
        # Green screen range
        lower_green = np.array([35, 100, 100])
        upper_green = np.array([85, 255, 255])
        mask_green = cv2.inRange(hsv, lower_green, upper_green)
        
        mask_obj = cv2.bitwise_not(mask_green)
        
        # Remove small noise by opening/closing if needed, but for now just find contours
        contours, _ = cv2.findContours(mask_obj, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Make green transparent
        img[mask_green > 0, 3] = 0
        
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            if w > 40 and h > 40:
                cropped = img[y:y+h, x:x+w]
                out_path = os.path.join(out_dir, f"{idx}.png")
                # Save with chinese path support
                is_success, im_buf_arr = cv2.imencode(".png", cropped)
                im_buf_arr.tofile(out_path)
                
                extracted.append((idx, cropped))
                idx += 1
                
    print(f"Extracted {len(extracted)} objects.")
    
    # Create a grid image of all extracted assets
    if len(extracted) == 0:
        return
        
    grid_cols = 5
    grid_rows = math.ceil(len(extracted) / grid_cols)
    cell_w, cell_h = 200, 250
    
    grid_img = np.zeros((grid_rows * cell_h, grid_cols * cell_w, 4), dtype=np.uint8)
    # Fill with dark gray background for visibility
    grid_img[:, :, :3] = 50
    grid_img[:, :, 3] = 255
    
    for i, (item_idx, cropped) in enumerate(extracted):
        r = i // grid_cols
        c = i % grid_cols
        
        # Resize if too large
        h, w = cropped.shape[:2]
        scale = min(180 / w, 180 / h, 1.0)
        new_w, new_h = int(w * scale), int(h * scale)
        if scale < 1.0:
            resized = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_AREA)
        else:
            resized = cropped
            
        x_off = c * cell_w + (cell_w - new_w) // 2
        y_off = r * cell_h + (cell_h - 50 - new_h) // 2 + 20
        
        # Paste with alpha blending
        alpha_s = resized[:, :, 3] / 255.0
        alpha_l = 1.0 - alpha_s
        
        for c_ch in range(0, 3):
            grid_img[y_off:y_off+new_h, x_off:x_off+new_w, c_ch] = (alpha_s * resized[:, :, c_ch] +
                                                                    alpha_l * grid_img[y_off:y_off+new_h, x_off:x_off+new_w, c_ch])
        grid_img[y_off:y_off+new_h, x_off:x_off+new_w, 3] = 255
        
        # Put text
        cv2.putText(grid_img, str(item_idx), (c * cell_w + 10, r * cell_h + cell_h - 10), 
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2, cv2.LINE_AA)
                    
    grid_path = os.path.join(asset_dir, "extracted_grid.png")
    cv2.imencode(".png", grid_img)[1].tofile(grid_path)
    print(f"Saved grid image to {grid_path}")

if __name__ == "__main__":
    asset_dir = r"d:\CRepository\BubbleFortune\asset"
    out_dir = r"d:\CRepository\BubbleFortune\asset\extracted"
    process_all_images(asset_dir, out_dir)
