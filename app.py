from copy import deepcopy
import streamlit as st
from PIL import Image, ImageDraw
import io
from streamlit_cropper import st_cropper
import os
import base64

# Function to convert bytes to a human-readable format
def convert_bytes(bytes_size):
    if bytes_size < 1024:
        return f"{bytes_size} Bytes"
    elif bytes_size < 1048576:
        return f"{bytes_size / 1024:.2f} KB"
    else:
        return f"{bytes_size / 1048576:.2f} MB"

# Header
st.markdown(
    """
    <style>
        .header {
            padding: 1.5rem;
            background-color: #FF5733;
            color: white;
            text-align: center;
            font-size: 2rem;
            font-weight: bold;
        }
        .footer {
            padding: 1.5rem;
            background-color: #F0F0F0;
            text-align: center;
        }
        .footer p {
            margin: 0.5rem;
            color: #333333;
            font-size: 1rem;
        }
        /* Sticky image in the top-right corner */
        .fixed-output {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 1000;
            background-color: white;
            padding: 10px;
            border: 2px solid #FF5733;
            border-radius: 10px;
            text-align: center;
            width: 150px;
        }
        .fixed-output img {
            max-width: 100%;
            border-radius: 8px;
        }
    </style>
    <div class="header">
        🎨 Interactive Image Editor 🎨
    </div>
    """,
    unsafe_allow_html=True,
)

# Main app layout and upload interface
st.markdown("<h5 style='text-align: center;'>Create stunning images effortlessly! 🌟</h5>", unsafe_allow_html=True)
uploaded_file = st.file_uploader("Upload an Image", type=["jpg", "jpeg", "png"], label_visibility="collapsed")

if uploaded_file:
    original_filename = uploaded_file.name
    name, ext = os.path.splitext(original_filename)
    
    img = Image.open(uploaded_file)
    
    if img.mode != "RGB":
        img = img.convert("RGB")

    # Display Original Image
    st.image(img, caption="Original Image", use_column_width=True)
    img_dimensions = img.size  
    st.markdown(f"<h5 style='color: #3EBAE1;'>Original Dimensions: {img_dimensions[0]} x {img_dimensions[1]} pixels</h5>", unsafe_allow_html=True)

    # Rotation option selection
    st.subheader("📐 Specify Orientation")
    # Mirroring option
    mirror = st.checkbox("🌟 Flip Horizontally")
    if mirror:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    rotate_option = st.selectbox("Rotation Option", ["No Rotation", "90° CW", "90° CCW", "Custom"])
    
    if rotate_option == "90° CW":
        img = img.rotate(-90, expand=True)
    elif rotate_option == "90° CCW":
        img = img.rotate(90, expand=True)
    elif rotate_option == "Custom":
        rotation_angle = st.slider("Rotate Image (degrees)", min_value=0, max_value=360, value=0)
        img = img.rotate(rotation_angle, expand=True)

    # Display the rotated image
    # st.image(img, caption="Rotated Image", use_column_width=True) #width=320

    def create_rule_of_third_image(img):
        # Define the grid color and width
        grid_color = (255, 255, 255)  # White color
        line_width = 2
        
        # Calculate rule of thirds positions
        width, height = img.size
        horizontal_third = width / 3
        vertical_third = height / 3
        
        # Create a draw object
        rule_of_third_img = deepcopy(img)
        draw = ImageDraw.Draw(rule_of_third_img)
        
        # Draw the rule of thirds grid
        # Vertical lines
        draw.line([(horizontal_third, 0), (horizontal_third, height)], fill=grid_color, width=line_width)
        draw.line([(2 * horizontal_third, 0), (2 * horizontal_third, height)], fill=grid_color, width=line_width)
        # Horizontal lines
        draw.line([(0, vertical_third), (width, vertical_third)], fill=grid_color, width=line_width)
        draw.line([(0, 2 * vertical_third), (width, 2 * vertical_third)], fill=grid_color, width=line_width)

        return rule_of_third_img
    
    rule_of_third_img = create_rule_of_third_image(img)
    # Display the image with grid
    st.image(rule_of_third_img, caption="Rotated Image", use_column_width=True)

    st.subheader("🔄 Specify Aspect Ratio for Cropping")
    aspect_ratio_input = st.text_input("Enter Aspect Ratio (e.g., 3:2 or 1:1)", value="1:1")
    
    if aspect_ratio_input:
        try:
            ratio = aspect_ratio_input.split(":")
            aspect_ratio = (float(ratio[0]), float(ratio[1]))
        except ValueError:
            st.error("Invalid format. Please use 'X:Y'.")
            aspect_ratio = (1, 1)
    else:
        aspect_ratio = (1, 1)

    # Crop the image
    st.subheader("✂️ Crop the Image")
    cropped_img = st_cropper(img, realtime_update=True, box_color="blue", aspect_ratio=aspect_ratio)

    # # show crop result
    # st.subheader("📸 Result")
    # st.image(cropped_img, caption="Cropped Image", use_column_width=True)

    cropped_dimensions = cropped_img.size  
    st.markdown(f"<h5 style='color: #3EBAE1;'>Cropped Dimensions: {cropped_dimensions[0]} x {cropped_dimensions[1]} pixels</h5>", unsafe_allow_html=True)

    width_values = [32, 40, 50, 80, 100, 160, 240, 320, 480, 640, 1080, 1280, 1920, 2560, 3840]
    width_values.append(cropped_dimensions[0])
    width_values.append(cropped_dimensions[1])
    width_values = sorted(set(width_values))    
    
    save_width = st.select_slider("📏 Select Width for Saving (in pixels)", options=width_values, value=cropped_dimensions[0])

    adjusted_height = int(save_width / aspect_ratio[0] * aspect_ratio[1])
    st.markdown(f"<h5 style='color: #3EBAE1;'>Adjusted Image Size: {save_width} x {adjusted_height} pixels</h5>", unsafe_allow_html=True)

    buffer = io.BytesIO()
    img_format = st.selectbox("💾 Save as", ["JPEG", "PNG", "PDF"])

    quality = 100  
    if img_format == "JPEG":
        quality = st.slider("Select JPEG Quality (1-100)", min_value=1, max_value=100, value=100)
        cropped_img = cropped_img.resize((save_width, adjusted_height), Image.LANCZOS)
        cropped_img.save(buffer, format="JPEG", quality=quality)
        save_filename = f"{name}-edited.jpg"
    elif img_format == "PNG":
        cropped_img = cropped_img.resize((save_width, adjusted_height), Image.LANCZOS)
        cropped_img.save(buffer, format="PNG")
        save_filename = f"{name}-edited.png"
    elif img_format == "PDF":
        cropped_img = cropped_img.resize((save_width, adjusted_height), Image.LANCZOS)
        pdf_buffer = io.BytesIO()
        cropped_img.convert("RGB").save(pdf_buffer, format="PDF")
        buffer = pdf_buffer
        save_filename = f"{name}-edited.pdf"

    buffer_size = buffer.tell()  
    expected_file_size = convert_bytes(buffer_size)

    # Get the byte data and convert to base64
    buffer.seek(0)  # Rewind the buffer to the beginning
    encoded_image = base64.b64encode(buffer.getvalue()).decode("utf-8")

    # Display fixed output image in the bottom-right corner
    st.markdown(
        f"""
        <div class="fixed-output">
            <p>Final Output</p>
            <p>📸</p>
            <img src="data:image/jpeg;base64,{encoded_image}" alt="Final Image">
            <p style="font-size: small; color: #999;">{expected_file_size}</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Footer with output image and download button
    st.markdown(
        f"""
        <div class="footer">
            <h4>✨ Final Output ✨</h4>
            <img src="data:image/{img_format.lower()};base64,{encoded_image}" alt="Final Image" width="200px">
            <p>Expected file size: {expected_file_size}</p>
            <a href="data:image/{img_format.lower()};base64,{encoded_image}" download="{save_filename}" class="button">
                🖥️ Download Final Image
            </a>
            <p style="font-size: small; color: #999;">"Creativity takes courage." - Henri Matisse ✨</p>
        </div>
        """,
        unsafe_allow_html=True,
    )