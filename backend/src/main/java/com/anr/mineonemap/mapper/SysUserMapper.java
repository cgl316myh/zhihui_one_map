package com.anr.mineonemap.mapper;

import com.anr.mineonemap.domain.SysUser;
import org.apache.ibatis.annotations.*;

import java.time.Instant;
import java.util.List;

@Mapper
public interface SysUserMapper {

    @Select("SELECT * FROM sys_user WHERE id = #{id}")
    SysUser findById(Long id);

    @Select("SELECT * FROM sys_user WHERE username = #{username}")
    SysUser findByUsername(String username);

    @Select("SELECT * FROM sys_user ORDER BY id")
    List<SysUser> findAll();

    @Insert("""
            INSERT INTO sys_user (username, password_hash, display_name, phone, role, enabled)
            VALUES (#{username}, #{passwordHash}, #{displayName}, #{phone}, #{role}, #{enabled})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(SysUser user);

    @Update("""
            UPDATE sys_user SET display_name = #{displayName}, phone = #{phone},
            role = #{role}, enabled = #{enabled}, updated_at = NOW()
            WHERE id = #{id}
            """)
    int update(SysUser user);

    @Update("UPDATE sys_user SET password_hash = #{passwordHash}, updated_at = NOW() WHERE id = #{id}")
    int updatePassword(@Param("id") Long id, @Param("passwordHash") String passwordHash);

    @Update("UPDATE sys_user SET last_login_at = #{lastLoginAt}, updated_at = NOW() WHERE id = #{id}")
    int updateLastLogin(@Param("id") Long id, @Param("lastLoginAt") Instant lastLoginAt);

    @Delete("DELETE FROM sys_user WHERE id = #{id}")
    int deleteById(Long id);
}
