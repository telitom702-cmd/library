# plugins/rename.py
import os
import time
import asyncio
from pyrogram import filters, Client
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup, ForceReply
from plugins.utils import active_downloads, user_files, Mdata01, Gthumb02
from plugins.functions.display_progress import progress_for_pyrogram

# যদি ইউজার Skip বাটনে ক্লিক করে
@Client.on_callback_query(filters.regex(r"^skip_upload$"))
async def skip_upload_cb(bot, query):
    user_id = query.from_user.id
    m = query.message

    if user_id not in user_files:
        return await query.answer("ডাউনলোড এখনও শেষ হয়নি! অপেক্ষা করুন...", show_alert=True)

    await query.answer("আপলোড শুরু হচ্ছে...")
    file_data = user_files.get(user_id)
    
    # আগের ক্যাপশন সহ আপলোড ফাংশন কল করা হলো
    await upload_process(bot, m, user_id, file_data["file_path"], file_data["caption"])


# যদি ইউজার Rename বাটনে ক্লিক করে
@Client.on_callback_query(filters.regex(r"^rename_upload$"))
async def rename_upload_cb(bot, query):
    user_id = query.from_user.id
    m = query.message

    if user_id not in user_files:
        return await query.answer("ডাউনলোড এখনও শেষ হয়নি! অপেক্ষা করুন...", show_alert=True)

    # ইউজারকে নতুন নাম লিখে রিপ্লাই করতে বলা হলো
    await m.edit_text(
        "**✏️ অনুগ্রহ করে নতুন ফাইলের নাম এবং ক্যাপশন লিখে রিপ্লাই করুন।**\n\n"
        "📝 উদাহরণ: `My Video.mp4`\n\n"
        "⚠️ আপনার নামের সাথে এক্সটেনশন (.mp4) দিতে ভুলবেন না।",
        reply_markup=ForceReply(selective=True)
    )


# ইউজার যখন নতুন নাম লিখে রিপ্লাই দেবে
@Client.on_message(filters.private & filters.reply)
async def get_new_name(bot, message):
    # চেক করা হচ্ছে এটি কি আমাদের বটের রিপ্লাই
    if not message.reply_to_message or not message.reply_to_message.text or "নতুন ফাইলের নাম" not in message.reply_to_message.text:
        return

    user_id = message.from_user.id
    m = message.reply_to_message # আগের বাটন ওয়ালা মেসেজ

    if user_id not in user_files:
        return await message.reply_text("**❌ ত্রুটি! ফাইলের তথ্য পাওয়া যায়নি।**")

    file_data = user_files.get(user_id)
    old_file_path = file_data["file_path"]

    # ইউজারের দেওয়া নতুন নাম
    user_text = message.text
    new_name = user_text.split("\n")[0] # প্রথম লাইন ফাইলের নাম
    # বাকি লাইনগুলো ক্যাপশন হিসেবে থাকবে
    new_caption = "\n".join(user_text.split("\n")[1:]) if "\n" in user_text else new_name

    # ফাইলের নাম পরিবর্তন (Rename) করা হলো
    new_file_path = os.path.join(os.path.dirname(old_file_path), new_name)
    os.rename(old_file_path, new_file_path)

    # ডিকশনারিতে নতুন পাথ আপডেট করা হলো
    user_files[user_id]["file_path"] = new_file_path

    await m.delete() # বাটন ওয়ালা মেসেজ ডিলিট
    await message.delete() # ইউজারের নাম ওয়ালা মেসেজ ডিলিট
    
    # নতুন নাম ও ক্যাপশন সহ আপলোড ফাংশন কল করা হলো
    await upload_process(bot, m, user_id, new_file_path, new_caption)


# মূল আপলোডের ফাংশন
async def upload_process(bot, m, user_id, file_path, caption):
    try:
        # আপলোডের আগে ক্যান্সেল বাটন রাখা হলো
        cancel_button = InlineKeyboardMarkup(
            [[InlineKeyboardButton("❌ বাতিল করুন", callback_data="cancel")]]
        )
        await m.edit_text("**⏳ আপলোড শুরু হচ্ছে... 🚀**", reply_markup=cancel_button)
        
        # মেটাডাটা এবং থাম্বনেইল বের করা
        width, height, duration = await Mdata01(file_path)
        
        # এখানে update অবজেক্ট না থাকায় একটি ডামি অবজেক্ট বা সরাসরি user_id পাঠানো হয়েছে (Gthumb02 অনুযায়ী)
        class DummyUpdate:
            def __init__(self, uid):
                self.from_user = type('User', (), {'id': uid})()
        dummy_update = DummyUpdate(user_id)
        
        thumb_image_path = await Gthumb02(bot, dummy_update, duration, file_path)
        
        u_time = time.time()
        
        # ভিডিও আপলোড শুরু
        await bot.send_video(
            chat_id=user_id,
            video=file_path,
            duration=duration,
            width=width,
            height=height,
            supports_streaming=True,
            thumb=thumb_image_path,
            caption=caption,
            progress=progress_for_pyrogram,
            progress_args=(
                "**আপলোড হচ্ছে... 🚀**",
                m,
                u_time
            )
        )

        # আপলোড শেষ হলে প্রগ্রেস মেসেজ ডিলিট করে দেওয়া হলো
        await m.delete()
        
    except Exception as e:
        error_text = str(e)
        if "বাতিল" in error_text:
            try: await m.edit_text("**❌ প্রক্রিয়া বাতিল করা হয়েছে!**")
            except: pass
        else:
            try: await m.edit_text(f"**এরর হয়েছে ❌\nকারণ: {e}**")
            except: pass
        
    finally:
        # কাজ শেষে ডিকশনারি থেকে ডেটা মুছে ফেলা
        if user_id in active_downloads:
            del active_downloads[user_id]
        if user_id in user_files:
            del user_files[user_id]
            
        # সার্ভার থেকে ফাইল ডিলিট করা
        try:
            if file_path and os.path.lexists(file_path):
                os.remove(file_path)
            if thumb_image_path and os.path.lexists(thumb_image_path):
                os.remove(thumb_image_path)
        except:
            pass
