import os
import logging
import asyncio

from pyrogram import Client, filters
from pyrogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    ForceReply
)
from pyrogram.errors import MessageNotModified

# আপনার প্রজেক্ট অনুযায়ী এগুলো ঠিক করুন
# from info import Config
# from database import db

logger = logging.getLogger(__name__)

# =========================================================
# CONFIG
# =========================================================

THUMBNAIL_DIR = "thumbnails"
VIDEO_DIR = "downloads" # ভিডিও ডাউনলোড করার জন্য ফোল্ডার
os.makedirs(THUMBNAIL_DIR, exist_ok=True)
os.makedirs(VIDEO_DIR, exist_ok=True)

# ইউজার কোন অবস্থায় আছে তা রাখবে
# {user_id: "waiting_for_thumb"}
thumb_waiting = {}


# =========================================================
# HELPER FUNCTIONS
# =========================================================

def get_thumb_path(user_id):
    return os.path.join(THUMBNAIL_DIR, f"{user_id}.jpg")

def get_video_path(user_id, message_id):
    return os.path.join(VIDEO_DIR, f"{user_id}_{message_id}.mp4")

def thumbnail_buttons():
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton(
                    "🏞️ SET NEW THUMBNAIL",
                    callback_data="set_new_thumb"
                ),
                InlineKeyboardButton(
                    "🗑️ DELETE",
                    callback_data="deleteThumbnail"
                )
            ]
        ]
    )

async def show_thumbnail_menu(bot, chat_id, user_id):
    """
    ইউজারের বর্তমান থাম্বনেইল অনুযায়ী মেনু দেখাবে।
    """
    thumbnail = await db.get_thumbnail(user_id)

    if thumbnail:
        text = (
            "**আপনার থাম্বনেইল আগে থেকেই সেট করা আছে! ✅**\n\n"
            "আপনি কি নতুন থাম্বনেইল সেট করতে চান, "
            "নাকি বর্তমানটি ডিলিট করতে চান?"
        )
        try:
            await bot.send_photo(
                chat_id=chat_id,
                photo=thumbnail,
                caption=text,
                reply_markup=thumbnail_buttons()
            )
        except Exception as e:
            logger.error(f"Thumbnail preview error: {e}")
            await bot.send_message(
                chat_id=chat_id,
                text=text,
                reply_markup=thumbnail_buttons()
            )
    else:
        text = (
            "**আপনার কোনো কাস্টম থাম্বনেইল সেট করা নেই ❌**\n\n"
            "নিচের বাটনে ক্লিক করে একটি ছবি পাঠান।"
        )
        await bot.send_message(
            chat_id=chat_id,
            text=text,
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            "🏞️ SET THUMBNAIL",
                            callback_data="set_new_thumb"
                        )
                    ]
                ]
            )
        )


# =========================================================
# THUMBNAIL COMMANDS
# =========================================================

@Client.on_message(filters.command("setthumb"))
async def thumbnail_menu(bot, update):
    await show_thumbnail_menu(bot, update.chat.id, update.from_user.id)

@Client.on_message(filters.command("viewthumb"))
async def view_thumbnail(bot, update):
    user_id = update.from_user.id
    thumbnail = await db.get_thumbnail(user_id)

    if not thumbnail:
        await update.reply_text(
            "❌ আপনার কোনো থাম্বনেইল সেট করা নেই।\n\n"
            "নতুন থাম্বনেইল সেট করতে /setthumb ব্যবহার করুন।"
        )
        return

    try:
        await bot.send_photo(
            chat_id=update.chat.id,
            photo=thumbnail,
            caption="🖼️ **আপনার বর্তমান থাম্বনেইল**"
        )
    except Exception as e:
        logger.error(f"View thumbnail error: {e}")
        await update.reply_text("⚠️ থাম্বনেইল দেখাতে সমস্যা হয়েছে।")

@Client.on_message(filters.command("delthumb"))
async def delete_thumbnail_command(bot, update):
    user_id = update.from_user.id
    thumbnail = await db.get_thumbnail(user_id)

    if not thumbnail:
        await update.reply_text("❌ আপনার কোনো থাম্বনেইল সেট করা নেই।")
        return

    download_location = get_thumb_path(user_id)
    try:
        if os.path.exists(download_location):
            os.remove(download_location)
    except Exception as e:
        logger.warning(f"Local thumbnail delete error: {e}")

    await db.set_thumbnail(user_id, thumbnail=None)
    thumb_waiting.pop(user_id, None)

    await update.reply_text(
        "🗑️ **আপনার কাস্টম থাম্বনেইল সফলভাবে ডিলিট করা হয়েছে!** ✅"
    )


# =========================================================
# CALLBACK QUERY
# =========================================================

@Client.on_callback_query(filters.regex(r"^(set_new_thumb|deleteThumbnail)$"))
async def thumb_callback(bot, query):
    user_id = query.from_user.id

    if query.data == "set_new_thumb":
        thumb_waiting[user_id] = True
        try:
            await query.message.edit_text(
                "**নতুন থাম্বনেইল সেট করতে একটি ছবি (Photo) পাঠান ⏳**\n\n"
                "📸 ছবিটি এই মেসেজের রিপ্লাই হিসেবে পাঠাতে পারেন।"
            )
        except MessageNotModified:
            pass

        await bot.send_message(
            chat_id=query.message.chat.id,
            text=(
                "🖼️ **এখানে আপনার ছবি পাঠান।**\n\n"
                "⚠️ শুধু Photo পাঠাবেন, Video বা Document নয়।"
            ),
            reply_markup=ForceReply(selective=True)
        )
        await query.answer("ছবির জন্য অপেক্ষা করছি...", show_alert=False)

    elif query.data == "deleteThumbnail":
        download_location = get_thumb_path(user_id)
        try:
            if os.path.exists(download_location):
                os.remove(download_location)
        except Exception as e:
            logger.warning(f"Local thumbnail delete error: {e}")

        await db.set_thumbnail(user_id, thumbnail=None)
        thumb_waiting.pop(user_id, None)

        try:
            await query.message.edit_text(
                "**আপনার কাস্টম থাম্বনেইল সফলভাবে ডিলিট করা হয়েছে!** 🗑️✅"
            )
        except MessageNotModified:
            pass
        await query.answer("থাম্বনেইল ডিলিট হয়েছে!", show_alert=False)


# =========================================================
# THUMBNAIL SAVE HANDLER (PHOTO)
# =========================================================

@Client.on_message(filters.photo)
async def save_thumbnail_photo(bot, message):
    user_id = message.from_user.id

    if user_id not in thumb_waiting:
        return

    try:
        download_location = get_thumb_path(user_id)
        if os.path.exists(download_location):
            os.remove(download_location)

        await message.download(file_name=download_location)
        thumbnail_file_id = message.photo.file_id

        await db.set_thumbnail(user_id, thumbnail=thumbnail_file_id)
        thumb_waiting.pop(user_id, None)

        await message.reply_text(
            "🎉 **আপনার থাম্বনেইল সফলভাবে সেট করা হয়েছে!** ✅\n\n"
            "এখন থেকে আপনার ভিডিওতে এই থাম্বনেইল ব্যবহার করা যাবে।",
            quote=True
        )
    except Exception as e:
        logger.exception(f"Save thumbnail error: {e}")
        await message.reply_text(
            "❌ **থাম্বনেইল সেভ করতে সমস্যা হয়েছে।**\n\nআবার চেষ্টা করুন।"
        )


# =========================================================
# VIDEO PROCESSING HANDLER (NEW ADDED)
# =========================================================

@Client.on_message(filters.video | (filters.document & filters.video))
async def handle_video_upload(bot, message: Message):
    user_id = message.from_user.id

    # ইউজার যদি থাম্বনেইল সেট করার অবস্থায় থাকে, তবে এই কোড কাজ করবে না
    # তখন invalid_thumbnail_media ফাংশন কাজ করবে
    if user_id in thumb_waiting:
        return

    # ইউজারের সেট করা থাম্বনেইল ডাটাবেস থেকে নিয়ে আসা
    thumbnail_file_id = await db.get_thumbnail(user_id)
    
    # প্রগ্রেস মেসেজ
    status_msg = await message.reply_text("⏳ **ভিডিও প্রসেস করা হচ্ছে...**\n\nডাউনলোড করা হচ্ছে... 0%")
    
    video_path = get_video_path(user_id, message.id)
    thumb_path = get_thumb_path(user_id)

    try:
        # 1. ভিডিও ডাউনলোড করা
        await message.download(
            file_name=video_path,
            progress=lambda d, t: asyncio.ensure_future(update_progress(status_msg, d, t, "ডাউনলোড"))
        )

        # 2. আপলোডের জন্য থাম্বনেইল চেক করা
        upload_thumb = None
        if thumbnail_file_id:
            # ডাটাবেসে থাম্বনেইল থাকলে সেটি ব্যবহার করা হবে
            upload_thumb = thumbnail_file_id
        elif os.path.exists(thumb_path):
            # ডাটাবেসে না থাকলে লোকাল ফাইল থাকলে সেটি ব্যবহার করা হবে
            upload_thumb = thumb_path

        # আপলোডের আগে স্ট্যাটাস আপডেট
        await status_msg.edit_text("⬆️ **আপলোড করা হচ্ছে...**\n\nআপলোড হচ্ছে... 0%")

        # 3. ভিডিও আপলোড করা (কাস্টম থাম্বনেইল সহ)
        await message.reply_video(
            video=video_path,
            thumb=upload_thumb,
            caption=message.caption or "", # ইউজারের দেওয়া ক্যাপশন রাখা হলো
            duration=message.video.duration if message.video else message.document.duration,
            width=message.video.width if message.video else 1280,
            height=message.video.height if message.video else 720,
            progress=lambda d, t: asyncio.ensure_future(update_progress(status_msg, d, t, "আপলোড"))
        )

        # সফলতার মেসেজ
        await status_msg.edit_text("✅ **ভিডিও সফলভাবে কাস্টম থাম্বনেইল সহ আপলোড করা হয়েছে!**")

    except Exception as e:
        logger.exception(f"Video upload error: {e}")
        await status_msg.edit_text("❌ **ভিডিও প্রসেস করতে সমস্যা হয়েছে!**\n\nআবার চেষ্টা করুন।")
    
    finally:
        # কাজ শেষে সার্ভার থেকে ভিডিও ফাইল ডিলিট করে দেওয়া (স্টোরেজ বাঁচানোর জন্য)
        if os.path.exists(video_path):
            try:
                os.remove(video_path)
            except Exception as e:
                logger.warning(f"Failed to delete video file: {e}")


async def update_progress(status_msg, downloaded, total, process_type):
    """প্রগ্রেস বার আপডেট করার জন্য হেল্পার ফাংশন"""
    if total > 0:
        percent = (downloaded * 100) / total
        try:
            await status_msg.edit_text(f"⏳ **{process_type} করা হচ্ছে...**\n\n{process_type}... {percent:.1f}%")
        except Exception:
            pass # MessageNotModified এরর এড়ানোর জন্য


# =========================================================
# INVALID MEDIA HANDLER (When waiting for thumbnail)
# =========================================================

@Client.on_message(filters.video | filters.document)
async def invalid_thumbnail_media(bot, message):
    user_id = message.from_user.id

    # ইউজার থাম্বনেইল সেট করার অবস্থায় না থাকলে কিছু করবে না 
    # (কারণ তখন handle_video_upload কাজ করবে)
    if user_id not in thumb_waiting:
        return

    await message.reply_text(
        "❌ **এটি থাম্বনেইল হিসেবে গ্রহণ করা যাবে না।**\n\n"
        "📸 দয়া করে একটি Photo পাঠান।"
    )

@Client.on_message(filters.text & ~filters.command(["setthumb", "viewthumb", "delthumb"]))
async def invalid_thumbnail_text(bot, message):
    user_id = message.from_user.id

    if user_id not in thumb_waiting:
        return

    await message.reply_text(
        "⚠️ **আমি একটি ছবির জন্য অপেক্ষা করছি।**\n\n"
        "📸 দয়া করে একটি Photo পাঠান।"
    )
